import type { ArtifactHubMatch } from "./types";

const PROXY_BASE = "/api/artifacthub";
const DIRECT_BASE = "https://artifacthub.io/api/v1";

interface ArtifactHubPackage {
  name: string;
  version: { version: string };
  repository: {
    name: string;
    url: string;
    kind: number;
  };
  description?: string;
  stars?: number;
}

function toMatch(pkg: ArtifactHubPackage): ArtifactHubMatch | null {
  const repoUrl = pkg.repository?.url;
  if (!repoUrl) return null;
  // Filter out OCI registries — Nuon [helm_repo] needs a standard HTTP repo URL
  if (repoUrl.startsWith("oci://")) return null;
  return {
    name: pkg.name,
    version: pkg.version?.version || "",
    repoUrl,
    repoName: pkg.repository?.name || "",
    description: pkg.description || "",
    stars: pkg.stars || 0,
  };
}

export async function searchArtifactHub(chartName: string): Promise<ArtifactHubMatch[]> {
  const q = encodeURIComponent(chartName);

  // Try Express proxy first (avoids CORS in browser)
  try {
    const res = await fetch(`${PROXY_BASE}/search?q=${q}`);
    if (res.ok) {
      const data = await res.json();
      const packages: ArtifactHubPackage[] = data.packages || data;
      return packages.map(toMatch).filter((m): m is ArtifactHubMatch => m !== null);
    }
  } catch {
    // proxy unavailable — try direct
  }

  // Fallback: direct call (works in dev without server, may fail in browser due to CORS)
  try {
    const res = await fetch(`${DIRECT_BASE}/packages/search?ts_query_web=${q}&kind=0&limit=10`);
    if (res.ok) {
      const data = await res.json();
      const packages: ArtifactHubPackage[] = data.packages || data;
      return packages.map(toMatch).filter((m): m is ArtifactHubMatch => m !== null);
    }
  } catch {
    // both failed
  }

  return [];
}

export function rankMatch(match: ArtifactHubMatch, chartName: string, githubOrg?: string): number {
  let score = 0;
  if (match.name.toLowerCase() === chartName.toLowerCase()) score += 10;
  if (githubOrg && match.repoName.toLowerCase().includes(githubOrg.toLowerCase())) score += 5;
  if (match.stars > 10) score += 1;
  return score;
}

export function pickBestMatch(
  matches: ArtifactHubMatch[],
  chartName: string,
  githubOrg?: string,
): ArtifactHubMatch | null {
  let best: ArtifactHubMatch | null = null;
  let bestScore = 0;
  for (const m of matches) {
    const score = rankMatch(m, chartName, githubOrg);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  // Only return if score is high enough (exact name match required)
  return bestScore >= 10 ? best : null;
}
