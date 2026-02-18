import base64
import io
import re
import tarfile
from dataclasses import dataclass, field

import httpx
import yaml

from app.config import GITHUB_TOKEN

_GITHUB_HEADERS: dict[str, str] = {"Accept": "application/vnd.github.v3+json"}


def _gh_headers() -> dict[str, str]:
    headers = dict(_GITHUB_HEADERS)
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


@dataclass
class ChartInfo:
    org: str
    repo: str
    branch: str
    directory: str
    chart_yaml: str
    values_yaml: str | None
    chart_name: str = ""
    chart_version: str = ""
    chart_description: str = ""
    app_version: str = ""
    dependencies: list[dict] = field(default_factory=list)
    helm_repo_url: str = ""  # non-empty when chart comes from a Helm registry (not GitHub)


def parse_github_url(url: str) -> tuple[str, str, str, str]:
    """Parse a GitHub URL into (org, repo, branch, directory).

    Supports formats:
      https://github.com/org/repo/tree/branch/path/to/chart
      https://github.com/org/repo (defaults to main, root dir)
    """
    url = url.strip().rstrip("/")

    pattern = r"https?://github\.com/([^/]+)/([^/]+)(?:/tree/([^/]+)(?:/(.+))?)?"
    match = re.match(pattern, url)
    if not match:
        raise ValueError(
            f"Invalid GitHub URL: {url}. "
            "Expected format: https://github.com/org/repo/tree/branch/path"
        )

    org = match.group(1)
    repo = match.group(2)
    branch = match.group(3) or "main"
    directory = match.group(4) or "."

    return org, repo, branch, directory


def is_github_url(text: str) -> bool:
    """Check whether text looks like a GitHub URL (vs a search query)."""
    text = text.strip()
    return text.startswith("http://github.com") or text.startswith("https://github.com")


def _parse_chart_yaml(content: str) -> dict:
    """Extract name, version, description, appVersion, and dependencies from Chart.yaml."""
    try:
        data = yaml.safe_load(content) or {}
    except yaml.YAMLError:
        data = {}

    result: dict = {
        "name": data.get("name", ""),
        "version": str(data.get("version", "")),
        "description": data.get("description", ""),
        "appVersion": str(data.get("appVersion", "")),
        "dependencies": [],
    }

    for dep in data.get("dependencies", []):
        if isinstance(dep, dict):
            result["dependencies"].append({
                "name": dep.get("name", ""),
                "version": str(dep.get("version", "")),
                "repository": dep.get("repository", ""),
                "condition": dep.get("condition", ""),
            })

    return result


async def search_repos(query: str) -> list[dict]:
    """Search GitHub for repos containing Helm charts.

    Uses code search with filename:Chart.yaml so every result is guaranteed
    to contain at least one Helm chart. Falls back to repo search with a
    topic:helm-chart qualifier if code search returns nothing.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        # Primary: code search for Chart.yaml files matching the query
        # (requires authentication — falls back to repo search if no token)
        data = {"items": []}
        if GITHUB_TOKEN:
            resp = await client.get(
                "https://api.github.com/search/code",
                params={"q": f"{query} filename:Chart.yaml", "per_page": 20},
                headers=_gh_headers(),
            )
            if resp.status_code == 403:
                raise RuntimeError("GitHub API rate limit exceeded. Try again shortly.")
            if resp.status_code == 200:
                data = resp.json()

        # Deduplicate by repo (code search returns one result per file)
        seen: set[str] = set()
        results: list[dict] = []
        for item in data.get("items", []):
            repo = item.get("repository", {})
            name = repo.get("full_name", "")
            if name in seen:
                continue
            seen.add(name)
            results.append({
                "full_name": name,
                "description": repo.get("description") or "",
                "stars": repo.get("stargazers_count", 0),
                "avatar_url": repo.get("owner", {}).get("avatar_url", ""),
                "default_branch": repo.get("default_branch", "main"),
            })
            if len(results) >= 8:
                break

        if results:
            return results

        # Fallback: repo search with helm-chart topic
        resp = await client.get(
            "https://api.github.com/search/repositories",
            params={"q": f"{query} topic:helm-chart", "sort": "stars", "per_page": 8},
            headers=_gh_headers(),
        )
        if resp.status_code == 403:
            raise RuntimeError("GitHub API rate limit exceeded. Try again shortly.")
        resp.raise_for_status()
        data = resp.json()

    results = []
    for item in data.get("items", []):
        results.append({
            "full_name": item["full_name"],
            "description": item.get("description") or "",
            "stars": item.get("stargazers_count", 0),
            "avatar_url": item.get("owner", {}).get("avatar_url", ""),
            "default_branch": item.get("default_branch", "main"),
        })
    return results


async def discover_charts(org: str, repo: str, branch: str) -> list[dict]:
    """Use GitHub Trees API to find all Chart.yaml files and parse them.

    Returns list of {name, version, description, path} per chart. Limit 25.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Get the full tree recursively
        resp = await client.get(
            f"https://api.github.com/repos/{org}/{repo}/git/trees/{branch}",
            params={"recursive": "1"},
            headers=_gh_headers(),
        )
        if resp.status_code == 403:
            raise RuntimeError("GitHub API rate limit exceeded. Try again shortly.")
        resp.raise_for_status()
        tree = resp.json()

        # Find all Chart.yaml files
        chart_paths = []
        for item in tree.get("tree", []):
            if item.get("type") == "blob" and item["path"].endswith("Chart.yaml"):
                chart_paths.append(item["path"])
            if len(chart_paths) >= 25:
                break

        # Fetch and parse each Chart.yaml
        charts = []
        for path in chart_paths:
            content = await fetch_file(client, org, repo, path, branch)
            if content is None:
                continue
            info = _parse_chart_yaml(content)
            # Derive the chart directory (parent of Chart.yaml)
            directory = "/".join(path.split("/")[:-1]) or "."
            charts.append({
                "name": info.get("name", path.rsplit("/", 1)[0] if "/" in path else repo),
                "version": info.get("version", ""),
                "description": info.get("description", ""),
                "path": directory,
                "dependencies": info.get("dependencies", []),
            })

    return charts


async def search_artifacthub(query: str) -> list[dict]:
    """Search ArtifactHub for Helm charts. Returns list of chart info dicts."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://artifacthub.io/api/v1/packages/search",
            params={"ts_query_web": query, "kind": 0, "limit": 8},
        )
        resp.raise_for_status()
        data = resp.json()

    results = []
    for pkg in data.get("packages", []):
        repo_info = pkg.get("repository", {})
        results.append({
            "name": pkg.get("name", ""),
            "description": pkg.get("description", ""),
            "version": pkg.get("version", ""),
            "stars": pkg.get("stars", 0),
            "logo_url": pkg.get("logo_image_id", ""),
            "repo_name": repo_info.get("name", ""),
            "repo_url": repo_info.get("url", ""),
            "official": repo_info.get("official", False),
        })
    return results


async def fetch_file(
    client: httpx.AsyncClient,
    org: str,
    repo: str,
    path: str,
    branch: str,
) -> str | None:
    """Fetch a file from GitHub API and return its decoded content."""
    url = f"https://api.github.com/repos/{org}/{repo}/contents/{path}"
    resp = await client.get(url, params={"ref": branch}, headers=_gh_headers())

    if resp.status_code == 404:
        return None
    if resp.status_code == 403:
        raise RuntimeError("GitHub API rate limit exceeded. Try again shortly.")
    resp.raise_for_status()

    data = resp.json()
    if data.get("encoding") == "base64":
        return base64.b64decode(data["content"]).decode("utf-8")
    return data.get("content", "")


async def fetch_chart(url: str) -> ChartInfo:
    """Fetch Chart.yaml and values.yaml from a GitHub Helm chart URL."""
    org, repo, branch, directory = parse_github_url(url)

    chart_path = f"{directory}/Chart.yaml" if directory != "." else "Chart.yaml"
    values_path = f"{directory}/values.yaml" if directory != "." else "values.yaml"

    async with httpx.AsyncClient(timeout=30.0) as client:
        chart_yaml = await fetch_file(client, org, repo, chart_path, branch)
        if chart_yaml is None:
            raise ValueError(
                f"No Chart.yaml found at {org}/{repo}/{chart_path}. "
                "Is this a Helm chart directory?"
            )

        values_yaml = await fetch_file(client, org, repo, values_path, branch)

    parsed = _parse_chart_yaml(chart_yaml)

    return ChartInfo(
        org=org,
        repo=repo,
        branch=branch,
        directory=directory,
        chart_yaml=chart_yaml,
        values_yaml=values_yaml,
        chart_name=parsed.get("name", ""),
        chart_version=parsed.get("version", ""),
        chart_description=parsed.get("description", ""),
        app_version=parsed.get("appVersion", ""),
        dependencies=parsed.get("dependencies", []),
    )


async def fetch_chart_from_artifacthub(repo_name: str, package_name: str) -> ChartInfo:
    """Fetch chart files from ArtifactHub by downloading the chart archive.

    Uses the ArtifactHub package API to get the content_url, then downloads
    and extracts Chart.yaml and values.yaml from the .tgz archive.
    """
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        # Get package details from ArtifactHub
        resp = await client.get(
            f"https://artifacthub.io/api/v1/packages/helm/{repo_name}/{package_name}",
        )
        if resp.status_code == 404:
            raise ValueError(f"Package {repo_name}/{package_name} not found on ArtifactHub.")
        resp.raise_for_status()
        pkg = resp.json()

        content_url = pkg.get("content_url", "")
        if not content_url:
            raise ValueError(f"No downloadable archive found for {repo_name}/{package_name}.")

        # Get the Helm registry URL for [helm_repo] block
        helm_repo_url = pkg.get("repository", {}).get("url", "")

        # Download the .tgz archive
        archive_resp = await client.get(content_url)
        archive_resp.raise_for_status()

    # Extract Chart.yaml and values.yaml from the archive
    chart_yaml = None
    values_yaml = None
    with tarfile.open(fileobj=io.BytesIO(archive_resp.content), mode="r:gz") as tar:
        for member in tar.getmembers():
            name = member.name
            # Files are typically at chartname/Chart.yaml or chartname/values.yaml
            basename = name.split("/", 1)[-1] if "/" in name else name
            if basename == "Chart.yaml" and chart_yaml is None:
                f = tar.extractfile(member)
                if f:
                    chart_yaml = f.read().decode("utf-8")
            elif basename == "values.yaml" and values_yaml is None:
                f = tar.extractfile(member)
                if f:
                    values_yaml = f.read().decode("utf-8")

    if chart_yaml is None:
        raise ValueError(f"No Chart.yaml found in archive for {repo_name}/{package_name}.")

    parsed = _parse_chart_yaml(chart_yaml)

    return ChartInfo(
        org=repo_name,
        repo=package_name,
        branch="",
        directory="",
        chart_yaml=chart_yaml,
        values_yaml=values_yaml,
        chart_name=parsed.get("name", package_name),
        chart_version=parsed.get("version", ""),
        chart_description=parsed.get("description", ""),
        app_version=parsed.get("appVersion", ""),
        dependencies=parsed.get("dependencies", []),
        helm_repo_url=helm_repo_url,
    )
