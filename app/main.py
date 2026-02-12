from fastapi import FastAPI, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.claude import generate_config, parse_files
from app.config import ANTHROPIC_API_KEY, STATIC_DIR, TEMPLATES_DIR
from app.github import (
    discover_charts,
    fetch_chart,
    is_github_url,
    parse_github_url,
    search_artifacthub,
    search_repos,
)

app = FastAPI(title="Bring Your Helm", version="0.2.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "has_api_key": bool(ANTHROPIC_API_KEY),
    })


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
    repo_url: str = Form(...),
    guidance: str = Form(""),
):
    """Fetch chart from GitHub, generate Nuon config via Claude, return JSON."""
    # Import cache here to avoid circular imports
    from app.cache import get_cached, set_cached

    # Phase 1: Fetch chart files
    try:
        chart = await fetch_chart(repo_url)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse(
            {"error": f"Failed to fetch chart from GitHub: {e}"}, status_code=502
        )

    chart_name = "unknown"
    for line in chart.chart_yaml.splitlines():
        if line.startswith("name:"):
            chart_name = line.split(":", 1)[1].strip().strip('"').strip("'")
            break

    # Check cache (only when guidance is empty)
    cache_key = f"{chart.org}/{chart.repo}@{chart.branch}:{chart.directory}"
    if not guidance:
        cached = get_cached(cache_key)
        if cached is not None:
            return JSONResponse({
                "chart_name": chart_name,
                "files": cached,
                "cached": True,
            })

    # Phase 2: Generate config via Claude
    try:
        response_text = await generate_config(chart, guidance)
    except Exception as e:
        return JSONResponse(
            {"error": f"Configuration generation failed: {e}"}, status_code=502
        )

    # Phase 3: Parse into files
    files = parse_files(response_text)
    files_data = [
        {"filename": f.filename, "language": f.language, "content": f.content}
        for f in files
    ]

    # Cache result if no custom guidance
    if not guidance:
        set_cached(cache_key, files_data)

    return JSONResponse({
        "chart_name": chart_name,
        "files": files_data,
        "cached": False,
    })
