from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.claude import generate_config, parse_files
from app.config import ANTHROPIC_API_KEY, STATIC_DIR, TEMPLATES_DIR
from app.github import fetch_chart

app = FastAPI(title="Bring Your Helm", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "has_api_key": bool(ANTHROPIC_API_KEY),
    })


@app.post("/analyze")
async def analyze(
    repo_url: str = Form(...),
    guidance: str = Form(""),
):
    """Fetch chart from GitHub, generate Nuon config via Claude, return JSON."""
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

    return JSONResponse({
        "chart_name": chart_name,
        "files": files_data,
    })
