# Bring Your Helm

Helm chart to Nuon BYOC configuration generator.

Search for any Helm chart on GitHub or ArtifactHub, pick the chart you want, configure your infrastructure options, and get a complete Nuon app configuration scaffold instantly.

## Local Development

**Prerequisites:** [uv](https://docs.astral.sh/uv/getting-started/installation/) (Python package manager)

```bash
# Clone the repo
git clone https://github.com/nuonco/bring-your-helm.git
cd bring-your-helm

# Install dependencies
uv sync

# Optional: set GitHub token for higher API rate limits
export GITHUB_TOKEN="ghp_..."

# Run the dev server
uv run uvicorn app.main:app --reload
```

Open http://localhost:8000

### GitHub Token (Optional)

Create a fine-grained token at https://github.com/settings/tokens with "Public repositories (read-only)" access. Without this you're limited to 60 GitHub API requests/hour; with a token you get 5,000/hr.

## How It Works

1. **Search** — Type a name (e.g. "signoz") or paste a GitHub URL. Search queries are proxied through the backend to use your GitHub token and avoid CORS.
2. **Pick a chart** — After selecting a repo, the app scans for all `Chart.yaml` files using GitHub's Trees API. If only one chart is found, it's auto-selected. Infrastructure dependencies are detected from Chart.yaml.
3. **Configure + Generate** — Select your cloud provider, infrastructure mode, and infrastructure dependencies (auto-detected deps are pre-checked). Config files are generated instantly from deterministic templates.
4. **Download** — Results appear as collapsible file cards. Download individual files or grab everything as a ZIP. Review the generated values.yaml and customize with Nuon template variables.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Landing page with wizard UI |
| `GET` | `/api/search?q=...` | Search GitHub repos (or parse a direct URL) |
| `GET` | `/api/search/artifacthub?q=...` | Search ArtifactHub for Helm charts |
| `POST` | `/api/discover` | Discover charts in a repo (form fields: `org`, `repo`, `branch`) |
| `POST` | `/analyze` | Generate Nuon config (form fields: `repo_url`, `cloud_provider`, `infra_mode`, `namespace`, `infra_deps`) |

## Caching

Generated configs are cached in-memory for 1 hour, keyed by chart location and user selections. Cached responses include a `"cached": true` flag, and the UI shows a "cached" badge.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | No | GitHub token for higher API rate limits (60/hr → 5,000/hr) |

## Project Structure

```
bring-your-helm/
├── app/
│   ├── main.py          # FastAPI routes (pages + API endpoints)
│   ├── github.py         # GitHub/ArtifactHub search, chart discovery, file fetching
│   ├── generator.py      # Deterministic Nuon config template generator
│   ├── cache.py           # TTL dict cache for generated configs
│   └── config.py          # Settings from env vars
├── templates/
│   ├── base.html          # Base layout (Tailwind CDN + JSZip)
│   └── index.html         # Wizard UI (search → pick → configure → download)
├── static/
│   └── styles.css         # Custom CSS (animations, selection glow)
├── pyproject.toml         # Dependencies (managed by uv)
├── render.yaml            # Render deployment config
└── uv.lock
```

## Deployment

Deployed to [Render](https://render.com) as a web service. Pushes to `main` auto-deploy.

- **Build command**: `pip install uv && uv sync`
- **Start command**: `uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Environment variables**: Optionally set `GITHUB_TOKEN` in Render's Environment settings

## Related

- [nuonco/nuon-plugin](https://github.com/nuonco/nuon-plugin) — Claude Code plugin for Nuon (advanced path for complex multi-component configs)
- [Nuon configuration docs](https://docs.nuon.co/configuration-files) — Full reference for Nuon TOML config files
