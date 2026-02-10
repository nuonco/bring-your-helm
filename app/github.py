import base64
import re
from dataclasses import dataclass

import httpx

from app.config import GITHUB_TOKEN


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


async def fetch_file(
    client: httpx.AsyncClient,
    org: str,
    repo: str,
    path: str,
    branch: str,
) -> str | None:
    """Fetch a file from GitHub API and return its decoded content."""
    headers = {"Accept": "application/vnd.github.v3+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

    url = f"https://api.github.com/repos/{org}/{repo}/contents/{path}"
    resp = await client.get(url, params={"ref": branch}, headers=headers)

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
