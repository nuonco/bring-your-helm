import type { GitHubRepo, HelmChart } from "./types";
import yaml from "js-yaml";

const GITHUB_API = "https://api.github.com";

export async function searchRepos(query: string): Promise<GitHubRepo[]> {
  if (!query.trim()) return [];
  const res = await fetch(
    `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=8`
  );
  if (!res.ok) throw new Error("GitHub API error");
  const data = await res.json();
  return data.items;
}

export async function parseRepoUrl(url: string): Promise<{ owner: string; repo: string; subpath?: string } | null> {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+?))?(?:\/)?$/);
  if (match) {
    return {
      owner: match[1],
      repo: match[2],
      subpath: match[3] || undefined,
    };
  }
  return null;
}

export async function getRepoByFullName(fullName: string): Promise<GitHubRepo> {
  const res = await fetch(`${GITHUB_API}/repos/${fullName}`);
  if (!res.ok) throw new Error("Repo not found");
  return res.json();
}

async function searchTree(owner: string, repo: string, branch: string, subpath?: string): Promise<string[]> {
  // If subpath is provided and the full tree might be truncated, use Contents API instead
  if (subpath) {
    return searchContentsRecursive(owner, repo, subpath);
  }
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  if (!res.ok) throw new Error("Could not fetch repo tree");
  const data = await res.json();
  if (data.truncated && !subpath) {
    throw new Error("Repository tree is too large. Try pasting a URL that points to a specific chart directory.");
  }
  return data.tree
    .filter((item: { type: string; path: string }) => item.type === "blob")
    .map((item: { path: string }) => item.path);
}

async function searchContentsRecursive(owner: string, repo: string, path: string): Promise<string[]> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`);
  if (!res.ok) throw new Error(`Could not fetch contents of ${path}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [data.path];
  const files: string[] = [];
  for (const item of data) {
    if (item.type === "file") {
      files.push(item.path);
    } else if (item.type === "dir") {
      // Only recurse one level deep to find Chart.yaml quickly
      const subRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${item.path}`);
      if (subRes.ok) {
        const subData = await subRes.json();
        if (Array.isArray(subData)) {
          for (const sub of subData) {
            if (sub.type === "file") files.push(sub.path);
          }
        }
      }
    }
  }
  return files;
}

export async function findHelmCharts(owner: string, repo: string, subpath?: string): Promise<HelmChart[]> {
  // Get default branch
  const repoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`);
  if (!repoRes.ok) throw new Error("Could not fetch repo");
  const repoData = await repoRes.json();
  const branch = repoData.default_branch;

  const files = await searchTree(owner, repo, branch, subpath);
  const chartYamls = files.filter((f) => f.endsWith("Chart.yaml"));

  const charts: HelmChart[] = [];
  for (const chartPath of chartYamls) {
    try {
      const content = await getFileContent(owner, repo, chartPath);
      const parsed = yaml.load(content) as Record<string, string>;
      charts.push({
        name: parsed.name || chartPath,
        version: parsed.version || "unknown",
        description: parsed.description || "",
        path: chartPath.replace("/Chart.yaml", ""),
      });
    } catch {
      charts.push({
        name: chartPath,
        version: "unknown",
        description: "",
        path: chartPath.replace("/Chart.yaml", ""),
      });
    }
  }
  return charts;
}

export async function getFileContent(owner: string, repo: string, path: string): Promise<string> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`);
  if (!res.ok) throw new Error(`Could not fetch ${path}`);
  const data = await res.json();
  return atob(data.content);
}
