from fastapi import FastAPI, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.config import STATIC_DIR, TEMPLATES_DIR
from app.generator import generate_config
from app.github import (
    discover_charts,
    fetch_chart,
    fetch_chart_from_artifacthub,
    is_github_url,
    parse_github_url,
    search_artifacthub,
    search_repos,
)

app = FastAPI(title="Bring Your Helm", version="0.3.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/search")
async def api_search(q: str = Query("")):
    """Search for GitHub repos, or parse a direct GitHub URL."""
    q = q.strip()
    if not q:
        return JSONResponse({"results": []})

    if is_github_url(q):
        try:
            org, repo, branch, directory = parse_github_url(q)
            return JSONResponse({"results": [{
                "full_name": f"{org}/{repo}",
                "description": f"Branch: {branch}, Path: {directory}",
                "stars": 0,
                "avatar_url": f"https://github.com/{org}.png?size=40",
                "default_branch": branch,
                "is_direct_url": True,
                "directory": directory,
            }]})
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    try:
        results = await search_repos(q)
        return JSONResponse({"results": results})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.post("/api/discover")
async def api_discover(
    org: str = Form(...),
    repo: str = Form(...),
    branch: str = Form("main"),
):
    """Discover Helm charts in a GitHub repository."""
    try:
        charts = await discover_charts(org, repo, branch)
        return JSONResponse({"charts": charts, "org": org, "repo": repo, "branch": branch})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/api/search/artifacthub")
async def api_search_artifacthub(q: str = Query("")):
    """Search ArtifactHub for Helm charts."""
    q = q.strip()
    if not q:
        return JSONResponse({"results": []})

    try:
        results = await search_artifacthub(q)
        return JSONResponse({"results": results})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.post("/analyze")
async def analyze(
    repo_url: str = Form(""),
    ah_repo: str = Form(""),
    ah_package: str = Form(""),
    cloud_provider: str = Form(""),
    infra_mode: str = Form(""),
    namespace: str = Form(""),
    config_repo: str = Form(""),
    infra_deps: str = Form(""),
):
    """Fetch chart and generate Nuon config deterministically.

    Accepts either a GitHub URL (repo_url) or ArtifactHub coordinates
    (ah_repo + ah_package).
    """
    from app.cache import get_cached, set_cached

    # Phase 1: Fetch chart files from GitHub or ArtifactHub
    if ah_repo and ah_package:
        try:
            chart = await fetch_chart_from_artifacthub(ah_repo, ah_package)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except Exception as e:
            return JSONResponse(
                {"error": f"Failed to fetch chart from ArtifactHub: {e}"}, status_code=502
            )
    elif repo_url:
        try:
            chart = await fetch_chart(repo_url)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except Exception as e:
            return JSONResponse(
                {"error": f"Failed to fetch chart from GitHub: {e}"}, status_code=502
            )
    else:
        return JSONResponse({"error": "No chart source provided."}, status_code=400)

    chart_name = chart.chart_name or "unknown"

    # Parse infra_deps from comma-separated string
    selected_deps = [d.strip() for d in infra_deps.split(",") if d.strip()]

    # Cache key includes source + user selections
    source_key = f"ah:{ah_repo}/{ah_package}" if ah_repo else f"{chart.org}/{chart.repo}@{chart.branch}:{chart.directory}"
    cache_key = (
        f"{source_key}"
        f"|{cloud_provider}|{infra_mode}|{namespace}|{','.join(sorted(selected_deps))}"
    )
    cached = get_cached(cache_key)
    if cached is not None:
        return JSONResponse({
            "chart_name": chart_name,
            "files": cached,
            "cached": True,
        })

    # Phase 2: Generate config deterministically
    files_data = generate_config(
        chart=chart,
        cloud_provider=cloud_provider,
        infra_mode=infra_mode,
        namespace=namespace,
        config_repo=config_repo.strip(),
        infra_deps=selected_deps,
    )

    set_cached(cache_key, files_data)

    return JSONResponse({
        "chart_name": chart_name,
        "files": files_data,
        "cached": False,
    })
