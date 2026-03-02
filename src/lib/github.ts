import type { GitHubRepo, HelmChart, ChartDependency, ChartFile } from "./types";
import yaml from "js-yaml";

const GITHUB_API = "https://api.github.com";

const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

async function ghFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error("GitHub API rate limit reached. Please wait a minute and try again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API error (${res.status})`);
  }
  return res;
}

async function ghFetchJson<T = any>(url: string): Promise<T> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data as T;
  }
  const res = await ghFetch(url);
  const data = await res.json();
  cache.set(url, { data, ts: Date.now() });
  return data as T;
}

export async function searchRepos(query: string): Promise<GitHubRepo[]> {
  if (!query.trim()) return [];
  const data = await ghFetchJson<{ items: GitHubRepo[] }>(
    `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=8`
  );
  return data.items;
}

export function parseRepoUrl(url: string): { owner: string; repo: string; subpath?: string } | null {
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
  return ghFetchJson<GitHubRepo>(`${GITHUB_API}/repos/${fullName}`);
}

async function searchTree(owner: string, repo: string, branch: string, subpath?: string): Promise<string[]> {
  if (subpath) {
    return searchContentsRecursive(owner, repo, subpath);
  }
  const data = await ghFetchJson<{ truncated?: boolean; tree: { type: string; path: string }[] }>(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  );
  if (data.truncated) {
    throw new Error("Repository tree is too large. Try pasting a URL that points to a specific chart directory.");
  }
  return data.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path);
}

async function searchContentsRecursive(owner: string, repo: string, path: string): Promise<string[]> {
  const data = await ghFetchJson<any>(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`);
  if (!Array.isArray(data)) return [data.path];
  const files: string[] = [];
  for (const item of data) {
    if (item.type === "file") {
      files.push(item.path);
    } else if (item.type === "dir") {
      const subData = await ghFetchJson<any>(`${GITHUB_API}/repos/${owner}/${repo}/contents/${item.path}`);
      if (Array.isArray(subData)) {
        for (const sub of subData) {
          if (sub.type === "file") files.push(sub.path);
        }
      }
    }
  }
  return files;
}

export async function findHelmCharts(owner: string, repo: string, subpath?: string): Promise<HelmChart[]> {
  const repoData = await ghFetchJson<{ default_branch: string }>(`${GITHUB_API}/repos/${owner}/${repo}`);
  const branch = repoData.default_branch;

  const files = await searchTree(owner, repo, branch, subpath);
  const chartYamls = files.filter((f) => f.endsWith("Chart.yaml"));

  const charts: HelmChart[] = [];
  for (const chartPath of chartYamls) {
    try {
      const content = await getFileContent(owner, repo, chartPath);
      const parsed = yaml.load(content) as Record<string, any>;
      const deps: ChartDependency[] = (parsed.dependencies || [])
        .filter((d: any) => typeof d === "object")
        .map((d: any) => ({
          name: d.name || "",
          version: String(d.version || ""),
          repository: d.repository || "",
          condition: d.condition || "",
        }));
      charts.push({
        name: parsed.name || chartPath,
        version: parsed.version || "unknown",
        description: parsed.description || "",
        path: chartPath.replace("/Chart.yaml", ""),
        dependencies: deps,
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
  const data = await ghFetchJson<{ content: string }>(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`);
  return atob(data.content);
}

const CHART_FILE_EXTENSIONS = new Set([
  ".yaml", ".yml", ".json", ".toml", ".tpl", ".txt", ".md", ".helmignore", ".lock",
]);

function hasAllowedExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".helmignore") || lower.endsWith("chart.lock")) return true;
  const dotIdx = lower.lastIndexOf(".");
  if (dotIdx === -1) return false;
  return CHART_FILE_EXTENSIONS.has(lower.slice(dotIdx));
}

async function listFilesRecursive(owner: string, repo: string, path: string): Promise<string[]> {
  const data = await ghFetchJson<any>(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`);
  if (!Array.isArray(data)) return [data.path];
  const files: string[] = [];
  const subdirs: string[] = [];
  for (const item of data) {
    if (item.type === "file") {
      files.push(item.path);
    } else if (item.type === "dir") {
      subdirs.push(item.path);
    }
  }
  const subResults = await Promise.all(
    subdirs.map((dir) => listFilesRecursive(owner, repo, dir))
  );
  for (const sub of subResults) {
    files.push(...sub);
  }
  return files;
}

export async function fetchChartFiles(
  owner: string,
  repo: string,
  chartPath: string,
): Promise<ChartFile[]> {
  const allPaths = await listFilesRecursive(owner, repo, chartPath);
  const prefix = chartPath.endsWith("/") ? chartPath : chartPath + "/";
  const filteredPaths = allPaths.filter((p) => {
    const rel = p.startsWith(prefix) ? p.slice(prefix.length) : p;
    if (rel === "values.yaml") return false;
    return hasAllowedExtension(p);
  });

  const results: ChartFile[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < filteredPaths.length; i += CONCURRENCY) {
    const batch = filteredPaths.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (filePath) => {
        const content = await getFileContent(owner, repo, filePath);
        const relativePath = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
        return { relativePath, content };
      })
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }
  }
  return results;
}
