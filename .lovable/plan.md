

# byocify.com — BYOC App Generator

A clean, modern single-page wizard that helps developers turn any Helm chart into a Nuon BYOC (Bring Your Own Cloud) application. The design follows a Lovable-style aesthetic: centered layout, clean typography, subtle gradients, and a polished feel.

---

## Page 1: Home / Search

- **Hero area** with a centered search input (similar to Lovable's home page prompt box) — large, prominent, with a placeholder like *"Paste a GitHub repo URL or search for one..."*
- Search queries the **GitHub public API** to find repositories — results appear in a dropdown below the input
- A secondary option to **"Connect your GitHub"** for accessing private repos (OAuth flow via GitHub)
- Minimal branding: "byocify" logo/wordmark at top, brief tagline like *"Turn any Helm chart into a BYOC app in minutes"*

## Page 2: Helm Chart Detection

- Once a repo is selected, the app scans the repository contents (via GitHub API) looking for Helm charts (`Chart.yaml` files)
- Displays the detected chart(s) with path, name, and version
- User confirms which chart to use, or can manually specify a path if auto-detection missed it
- Clean card-based UI showing the chart details

## Page 3: Values Editor

- Fetches the `values.yaml` from the selected Helm chart
- Renders it in a **code editor** (Monaco-based) with YAML syntax highlighting
- The editor supports Nuon's templating variables (e.g., `{{.nuon.install.public_domain}}`, `{{.nuon.install.inputs.custom_var}}`) — shown as autocomplete suggestions or a sidebar reference panel
- A **reference panel** on the side lists available Nuon variables (install inputs, infrastructure outputs, etc.) that users can click to insert
- Users can edit values to wire up their chart with Nuon's variable system

## Page 4: Generate & Download

- Shows a preview of the generated **Nuon configuration file** (the `.toml` component config)
- User can **copy to clipboard** or **download** the config
- Brief instructions on next steps (e.g., "Add this to your Nuon app repo and run `nuon apps create`")

---

## Design & UX

- **Single-page wizard** with a step indicator at the top
- Smooth transitions between steps
- Dark mode support
- Mobile responsive but optimized for desktop (developer tool)
- Clean, minimal aesthetic — dark background option with accent colors

## Technical Notes

- GitHub API (public, unauthenticated) for repo search and file browsing
- No backend needed for the initial version — all client-side
- Monaco editor for the YAML/values editing experience
- Local state management for the wizard flow

