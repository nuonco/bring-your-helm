# BYO Helm — Nuon Config Generator

A web app that takes any public Helm chart and generates a complete [Nuon](https://nuon.co) BYOC (Bring Your Own Cloud) app configuration scaffold.

## What it does

1. **Search** — Find a Helm chart by searching GitHub repos or pasting a repo URL
2. **Detect** — Automatically discovers `Chart.yaml` files and parses chart metadata + dependencies
3. **Configure** — Edit `values.yaml` in a Monaco editor, pick cloud provider / infra mode / infra dependencies, set namespace and config repo
4. **Generate** — Produces a full multi-file Nuon app config:
   - `metadata.toml` — app display name and version
   - `inputs.toml` — customer-facing inputs (subdomain, admin password, db name)
   - `sandbox.toml` — EKS or AKS sandbox
   - `runner.toml` — runner type
   - `stack.toml` — CloudFormation stack
   - `break_glass.toml` — break-glass emergency access role
   - `permissions/` — provision, maintenance, deprovision IAM roles + boundary policies
   - `components/N-chart.toml` — the Helm chart component with `[public_repo]` pointing to the source
   - `components/values/chart/values.yaml` — templated values with Nuon variable wiring
   - Infrastructure components (RDS, ElastiCache, S3) with Terraform when dependencies are detected
   - `actions/db-credentials.toml` — Kubernetes secret sync when a database dependency is present

The generated config can be downloaded as a ZIP, and each file is individually viewable and copyable.

## Key features

- **Auto-detection** of infrastructure dependencies from `Chart.yaml` (PostgreSQL, MySQL, Redis, S3)
- **Password rewriting** — automatically replaces hardcoded passwords in values.yaml with `{{ .nuon.inputs.inputs.admin_password }}`
- **Infra wiring** — disables bundled subcharts and wires external database/cache/storage connections via Nuon template variables
- **Ingress wiring** — sets up hostname templates using `{{ .nuon.inputs.inputs.subdomain }}.{{ .nuon.install.sandbox.outputs.nuon_dns.public_domain.name }}`
- **Infrastructure mode** — "Default", "Bring own VPC", or "Bring own cluster" (skips sandbox/runner/stack generation)
- **Cloud provider toggle** — AWS (EKS) or Azure (AKS)
- **Next-steps guide** — walks users through creating a git repo, syncing with the Nuon CLI, and validating

## Tech stack

- [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/) + [React](https://react.dev/)
- [shadcn/ui](https://ui.shadcn.com/) + [Tailwind CSS](https://tailwindcss.com/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) for YAML editing
- [Shiki](https://shiki.style/) for syntax highlighting
- [JSZip](https://stuk.github.io/jszip/) for ZIP downloads
- GitHub REST API for repo search and file content

## Development

```sh
git clone https://github.com/nuonco/byo-helm.git
cd byo-helm
npm install
npm run dev
```

## Related

- [Nuon docs — Configuration files](https://docs.nuon.co/configuration-files)
- [Nuon CLI](https://docs.nuon.co/cli)
