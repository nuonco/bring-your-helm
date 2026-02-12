import base64
import re
from dataclasses import dataclass

import httpx

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


def _parse_chart_yaml(content: str) -> dict[str, str]:
    """Extract name, version, description from Chart.yaml content (line-based, no pyyaml)."""
    result: dict[str, str] = {}
    for line in content.splitlines():
        for key in ("name", "version", "description"):
            if line.startswith(f"{key}:"):
                val = line.split(":", 1)[1].strip().strip('"').strip("'")
                result[key] = val
    return result


async def search_repos(query: str) -> list[dict]:
    """Search GitHub for repos containing Helm charts.

    Uses code search with filename:Chart.yaml so every result is guaranteed
    to contain at least one Helm chart. Falls back to repo search with a
    topic:helm-chart qualifier if code search returns nothing.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        # Primary: code search for Chart.yaml files matching the query
        resp = await client.get(
            "https://api.github.com/search/code",
            params={"q": f"{query} filename:Chart.yaml", "per_page": 20},
            headers=_gh_headers(),
        )
        if resp.status_code == 403:
            raise RuntimeError("GitHub API rate limit exceeded. Try again shortly.")
        resp.raise_for_status()
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

    return ChartInfo(
        org=org,
        repo=repo,
        branch=branch,
        directory=directory,
        chart_yaml=chart_yaml,
        values_yaml=values_yaml,
    )
