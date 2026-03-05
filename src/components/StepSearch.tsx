import { useState, useRef, useEffect, useMemo } from "react";
import { ArrowRight, Loader2, Star, Search, Plus, Package, ChevronDown, Cloud, Download, FileText, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchRepos, parseRepoUrl, getRepoByFullName, getUserRepos, repoHasHelmChart } from "@/lib/github";
import { useAuth } from "@/hooks/use-auth";
import { trackEvent } from "@/lib/analytics";
import type { GitHubRepo, WizardAction } from "@/lib/types";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

interface CommunityConfig {
  full_name: string;
  html_url: string;
  description: string | null;
  chart_name: string;
  chart_path: string;
  ts: number;
}

const FEATURED_REPOS: (GitHubRepo & { stars_short: string })[] = [
  {
    id: 283654498,
    full_name: "grafana/helm-charts",
    description: "Official Grafana Labs Helm Charts for Kubernetes",
    html_url: "https://github.com/grafana/helm-charts",
    stargazers_count: 1900,
    stars_short: "1.9k",
    owner: { login: "grafana", avatar_url: "https://avatars.githubusercontent.com/u/7195757" },
  },
  {
    id: 92998784,
    full_name: "bitnami/charts",
    description: "Bitnami Helm Charts library for Kubernetes deployments",
    html_url: "https://github.com/bitnami/charts",
    stargazers_count: 10100,
    stars_short: "10.1k",
    owner: { login: "bitnami", avatar_url: "https://avatars.githubusercontent.com/u/34656521" },
  },
  {
    id: 75859950,
    full_name: "cert-manager/cert-manager",
    description: "Automatically provision and manage TLS certificates in Kubernetes",
    html_url: "https://github.com/cert-manager/cert-manager",
    stargazers_count: 12500,
    stars_short: "12.5k",
    owner: { login: "cert-manager", avatar_url: "https://avatars.githubusercontent.com/u/93504282" },
  },
  {
    id: 144573375,
    full_name: "argoproj/argo-helm",
    description: "ArgoProj Helm Charts for Argo CD, Workflows, Rollouts, and Events",
    html_url: "https://github.com/argoproj/argo-helm",
    stargazers_count: 1800,
    stars_short: "1.8k",
    owner: { login: "argoproj", avatar_url: "https://avatars.githubusercontent.com/u/30269780" },
  },
  {
    id: 58518752,
    full_name: "kubernetes/ingress-nginx",
    description: "Ingress NGINX Controller for Kubernetes",
    html_url: "https://github.com/kubernetes/ingress-nginx",
    stargazers_count: 18100,
    stars_short: "18.1k",
    owner: { login: "kubernetes", avatar_url: "https://avatars.githubusercontent.com/u/13629408" },
  },
  {
    id: 308009573,
    full_name: "prometheus-community/helm-charts",
    description: "Prometheus community Helm charts",
    html_url: "https://github.com/prometheus-community/helm-charts",
    stargazers_count: 2100,
    stars_short: "2.1k",
    owner: { login: "prometheus-community", avatar_url: "https://avatars.githubusercontent.com/u/3380462" },
  },
  {
    id: 263227190,
    full_name: "external-secrets/external-secrets",
    description: "External Secrets Operator for Kubernetes",
    html_url: "https://github.com/external-secrets/external-secrets",
    stargazers_count: 4800,
    stars_short: "4.8k",
    owner: { login: "external-secrets", avatar_url: "https://avatars.githubusercontent.com/u/89498289" },
  },
  {
    id: 233840943,
    full_name: "traefik/traefik-helm-chart",
    description: "Traefik Proxy Helm Chart for Kubernetes",
    html_url: "https://github.com/traefik/traefik-helm-chart",
    stargazers_count: 1100,
    stars_short: "1.1k",
    owner: { login: "traefik", avatar_url: "https://avatars.githubusercontent.com/u/17437284" },
  },
];

interface StepSearchProps {
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  configCount?: number;
}

export function StepSearch({ dispatch, onNext, configCount = 0 }: StepSearchProps) {
  const { token, isAuthenticated, isConfigured, signIn } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [expandedBlock, setExpandedBlock] = useState<number | null>(null);
  const toggleBlock = (index: number) => setExpandedBlock(prev => prev === index ? null : index);
  const [userRepos, setUserRepos] = useState<GitHubRepo[]>([]);
  const [userReposLoading, setUserReposLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    setUserReposLoading(true);
    getUserRepos(token)
      .then(async (repos) => {
        // Check each repo for Chart.yaml in parallel
        const checks = await Promise.all(
          repos.map(async (repo) => {
            const [owner, name] = repo.full_name.split("/");
            const hasChart = await repoHasHelmChart(owner, name, token);
            return { repo, hasChart };
          })
        );
        setUserRepos(checks.filter((c) => c.hasChart).map((c) => c.repo));
      })
      .catch(() => setUserRepos([]))
      .finally(() => setUserReposLoading(false));
  }, [isAuthenticated, token]);

  const communityConfigs = useMemo<CommunityConfig[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("byocify-community") || "[]");
    } catch { return []; }
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectRepo = (repo: GitHubRepo, subpath?: string, source?: string) => {
    trackEvent("repo_selected", { repo_name: repo.full_name, source: source || "search" });
    dispatch({ type: "SET_REPO", repo, subpath });
    setShowResults(false);
    onNext();
  };

  const resolveAndGo = async (url: string) => {
    setLoading(true);
    setError("");
    try {
      const parsed = parseRepoUrl(url);
      if (parsed) {
        const repo = await getRepoByFullName(`${parsed.owner}/${parsed.repo}`);
        selectRepo(repo, parsed.subpath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach that repository.");
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    setError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const parsed = parseRepoUrl(value);
        if (parsed) {
          const repo = await getRepoByFullName(`${parsed.owner}/${parsed.repo}`);
          (repo as any)._subpath = parsed.subpath;
          setResults([repo]);
        } else {
          const repos = await searchRepos(value);
          setResults(repos);
        }
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  };

  const handleSuggestion = (repo: GitHubRepo) => {
    selectRepo(repo, undefined, "featured");
  };

  const handleSubmit = async () => {
    if (results.length >= 1) {
      selectRepo(results[0], (results[0] as any)._subpath);
    } else if (query.trim()) {
      await resolveAndGo(query.trim());
    }
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-medium tracking-tight text-foreground text-center mb-3 sm:mb-4">
        Turn any Helm chart into a BYOC app
      </h1>
      <p className="text-base text-muted-foreground text-center max-w-lg mx-auto mb-8 sm:mb-10 leading-relaxed">
        Set up your <a href="https://nuon.co" target="_blank" rel="noopener noreferrer" className="text-foreground font-medium hover:text-primary transition-colors">Nuon</a> BYOC app in minutes.<br />One&#x2011;click installs for your customers.
      </p>

      {/* Search bar */}
      <div ref={containerRef} className="relative max-w-xl mx-auto mb-8 sm:mb-12">
        <div className="relative flex items-center bg-card rounded-xl border border-border hover:border-muted-foreground/30 transition-colors">
          <Search className="w-4 h-4 text-muted-foreground ml-4 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="Search for repositories (or paste a link)"
            className="flex-1 bg-transparent px-3 py-3.5 text-base text-foreground placeholder:text-muted-foreground outline-none"
          />
          {loading && (
            <div className="mr-3">
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
            </div>
          )}
        </div>

        {error && (
          <p className="mt-2 text-sm text-destructive px-1">{error}</p>
        )}

        {showResults && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50">
            {results.map((repo) => (
              <button
                key={repo.id}
                onClick={() => selectRepo(repo, (repo as any)._subpath)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left group"
              >
                <img src={repo.owner.avatar_url} alt="" className="w-6 h-6 rounded-full shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-base font-medium text-foreground truncate">{repo.full_name}</div>
                  {repo.description && (
                    <div className="text-sm text-muted-foreground truncate mt-0.5">{repo.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                  <Star className="w-3 h-3" />
                  {repo.stargazers_count.toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Your Repositories */}
      {isAuthenticated && userRepos.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Repositories</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden">
            {userRepos.slice(0, 6).map((repo) => (
              <button
                key={repo.id}
                onClick={() => selectRepo(repo, undefined, "user_repo")}
                className="text-left px-5 py-4 bg-card hover:bg-muted/30 transition-all group flex items-start gap-3"
              >
                <img src={repo.owner.avatar_url} alt="" className="w-5 h-5 rounded-full mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-base font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    {repo.full_name}
                  </div>
                  {repo.description && (
                    <div className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{repo.description}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {isAuthenticated && userReposLoading && (
        <div className="flex items-center gap-2 mb-8 text-sm text-muted-foreground justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading your repositories...
        </div>
      )}
      {!isAuthenticated && isConfigured && (
        <div className="mb-8">
          <button
            onClick={() => { trackEvent("sign_in_clicked", { source: "landing" }); signIn(); }}
            className="w-full flex items-center gap-3 px-5 py-4 bg-card rounded-lg border border-border hover:border-muted-foreground/30 hover:bg-muted/30 transition-all group"
          >
            <GitHubIcon className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            <div className="text-left">
              <span className="text-sm font-medium text-foreground">Sign in with GitHub</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Access your private repositories and Helm charts
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground ml-auto shrink-0 transition-colors" />
          </button>
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden">
        {[
          { type: "add" as const },
          ...FEATURED_REPOS.map((r) => ({ type: "repo" as const, repo: r })),
        ].map((item) => {
          if (item.type === "add") {
            return (
              <button
                key="add"
                onClick={focusInput}
                className="text-left px-5 py-5 bg-primary/5 hover:bg-primary/10 transition-all group h-[160px] flex flex-col justify-between"
              >
                <div>
                  <Plus className="w-4 h-4 text-primary mb-1.5" />
                  <div className="text-base font-medium text-foreground">Connect your repo</div>
                  <div className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    Paste a GitHub repo URL or search above to find your chart
                  </div>
                </div>
                <div className="flex items-center justify-end">
                  <div className="w-6 h-6 rounded-full border border-primary/30 group-hover:border-primary group-hover:bg-primary/10 flex items-center justify-center transition-all">
                    <ArrowRight className="w-3 h-3 text-primary/60 group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </button>
            );
          }

          const repo = item.repo!;
          return (
            <button
              key={repo.full_name}
              onClick={() => handleSuggestion(repo)}
              className="text-left px-5 py-5 bg-card hover:bg-muted/30 transition-all group h-[160px] flex flex-col justify-between"
            >
              <div>
                <div className="text-base font-medium text-foreground group-hover:text-primary transition-colors">
                  {repo.full_name}
                </div>
                <div className="text-sm text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                  {repo.description}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Star className="w-3 h-3 fill-muted-foreground/50" />
                  <span className="font-medium">{repo.stars_short}</span>
                </span>
                <div className="w-6 h-6 rounded-full border border-border group-hover:border-muted-foreground/50 group-hover:bg-muted flex items-center justify-center transition-all">
                  <ArrowRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* How it works — below the grid */}
      <div className="max-w-xl lg:max-w-3xl mx-auto mt-14 sm:mt-20">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            How it works
          </div>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          {([
            { idx: 0, title: "Find your chart", subtitle: "Search GitHub or paste a link — we scan for Chart.yaml and values.yaml", Icon: Search },
            { idx: 1, title: "Configure for BYOC", subtitle: "Nuon detects dependencies and wires up managed cloud infrastructure", Icon: Cloud },
            { idx: 2, title: "Download & deploy", subtitle: "Get a Nuon config package — push to GitHub, connect to Nuon, deploy", Icon: Download },
          ] as const).map(({ idx, title, subtitle, Icon }) => (
            <div key={idx} className={cn("bg-card rounded-xl border overflow-hidden transition-colors", expandedBlock === idx ? "border-primary/30" : "border-border")}>
              <button
                onClick={() => toggleBlock(idx)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
              >
                <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
                </div>
                <Icon className="w-4 h-4 text-muted-foreground shrink-0 mr-1 hidden sm:block" />
                <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0", expandedBlock === idx && "rotate-180")} />
              </button>

              {/* Mobile inline expansion */}
              <div className={cn("lg:hidden grid transition-all duration-200 ease-out", expandedBlock === idx ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <div className="overflow-hidden">
                  <div className="px-4 pb-4 pt-1 border-t border-border">
                    {idx === 0 && (
                      <>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                          Paste a GitHub URL or search by name. We scan the repo for Helm charts,
                          read Chart.yaml for dependencies, and parse values.yaml to detect passwords,
                          ingress, and infrastructure subcharts.
                        </p>
                        <div className="flex items-center gap-2 text-xs overflow-x-auto pb-1">
                          <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-2 shrink-0">
                            <Package className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="font-mono text-foreground">your-org/your-app</span>
                          </div>
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          <div className="flex flex-col gap-1 shrink-0">
                            <div className="bg-muted/60 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                              <FileText className="w-3 h-3 text-primary/60" />
                              <span className="font-mono text-muted-foreground">Chart.yaml</span>
                            </div>
                            <div className="bg-muted/60 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                              <FileText className="w-3 h-3 text-primary/60" />
                              <span className="font-mono text-muted-foreground">values.yaml</span>
                            </div>
                          </div>
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          <div className="bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 shrink-0">
                            <span className="text-primary font-medium">Dependencies detected</span>
                          </div>
                        </div>
                      </>
                    )}
                    {idx === 1 && (
                      <>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                          Bundled Helm subcharts get replaced with managed cloud services that Nuon
                          provisions in each customer's account. You choose the cloud provider
                          (AWS or Azure) and infrastructure mode. Nuon handles provisioning, credentials,
                          and teardown automatically.
                        </p>
                        <div className="space-y-1.5 text-xs">
                          {[
                            { from: "postgresql", to: "Amazon RDS" },
                            { from: "redis / valkey", to: "ElastiCache" },
                            { from: "minio", to: "S3 Bucket" },
                          ].map((row) => (
                            <div key={row.from} className="flex items-center gap-2">
                              <div className="bg-muted/60 rounded-lg px-3 py-1.5 font-mono text-muted-foreground w-28 shrink-0 truncate">{row.from}</div>
                              <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                              <div className="bg-primary/10 border border-primary/20 rounded-lg px-3 py-1.5 font-medium text-primary flex-1">{row.to}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {idx === 2 && (
                      <>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                          You get a ZIP with a complete Nuon config package — push it to GitHub, connect to Nuon,
                          and ship to your first customer's cloud. Nuon handles continuous delivery from there.
                        </p>
                        <div className="bg-muted/40 rounded-lg px-4 py-3 font-mono text-xs leading-relaxed">
                          <div className="text-foreground font-medium mb-1">your-app/</div>
                          <div className="text-muted-foreground pl-4 space-y-0.5">
                            <div><span className="text-foreground">metadata.toml</span> <span className="text-muted-foreground/60 ml-2">— app identity</span></div>
                            <div><span className="text-foreground">sandbox.toml</span> <span className="text-muted-foreground/60 ml-2">— environment config</span></div>
                            <div><span className="text-foreground">inputs.toml</span> <span className="text-muted-foreground/60 ml-2">— customer settings</span></div>
                            <div className="text-foreground font-medium mt-1">components/</div>
                            <div className="pl-4 space-y-0.5">
                              <div><span className="text-muted-foreground">1-rds.toml</span> <span className="text-muted-foreground/60 ml-2">— managed database</span></div>
                              <div><span className="text-muted-foreground">2-your-app.toml</span> <span className="text-muted-foreground/60 ml-2">— Helm release</span></div>
                              <div><span className="text-muted-foreground">values/values.yaml</span> <span className="text-muted-foreground/60 ml-2">— templated values</span></div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop expansion panel */}
        <div className={cn("hidden lg:grid transition-all duration-200 ease-out mt-2", expandedBlock !== null ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
          <div className="overflow-hidden">
            <div className="bg-card rounded-xl border border-border px-5 pb-4 pt-3">
              {expandedBlock === 0 && (
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                    Paste a GitHub URL or search by name. We scan the repo for Helm charts,
                    read Chart.yaml for dependencies, and parse values.yaml to detect passwords,
                    ingress, and infrastructure subcharts.
                  </p>
                  <div className="flex items-center gap-2 text-xs overflow-x-auto pb-1">
                    <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-2 shrink-0">
                      <Package className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-mono text-foreground">your-org/your-app</span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <div className="flex flex-col gap-1 shrink-0">
                      <div className="bg-muted/60 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-primary/60" />
                        <span className="font-mono text-muted-foreground">Chart.yaml</span>
                      </div>
                      <div className="bg-muted/60 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                        <FileText className="w-3 h-3 text-primary/60" />
                        <span className="font-mono text-muted-foreground">values.yaml</span>
                      </div>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                    <div className="bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 shrink-0">
                      <span className="text-primary font-medium">Dependencies detected</span>
                    </div>
                  </div>
                </>
              )}
              {expandedBlock === 1 && (
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                    Bundled Helm subcharts get replaced with managed cloud services that Nuon
                    provisions in each customer's account. You choose the cloud provider
                    (AWS or Azure) and infrastructure mode. Nuon handles provisioning, credentials,
                    and teardown automatically.
                  </p>
                  <div className="space-y-1.5 text-xs">
                    {[
                      { from: "postgresql", to: "Amazon RDS" },
                      { from: "redis / valkey", to: "ElastiCache" },
                      { from: "minio", to: "S3 Bucket" },
                    ].map((row) => (
                      <div key={row.from} className="flex items-center gap-2">
                        <div className="bg-muted/60 rounded-lg px-3 py-1.5 font-mono text-muted-foreground w-28 shrink-0 truncate">{row.from}</div>
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <div className="bg-primary/10 border border-primary/20 rounded-lg px-3 py-1.5 font-medium text-primary flex-1">{row.to}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {expandedBlock === 2 && (
                <>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                    You get a ZIP with a complete Nuon config package — push it to GitHub, connect to Nuon,
                    and ship to your first customer's cloud. Nuon handles continuous delivery from there.
                  </p>
                  <div className="bg-muted/40 rounded-lg px-4 py-3 font-mono text-xs leading-relaxed">
                    <div className="text-foreground font-medium mb-1">your-app/</div>
                    <div className="text-muted-foreground pl-4 space-y-0.5">
                      <div><span className="text-foreground">metadata.toml</span> <span className="text-muted-foreground/60 ml-2">— app identity</span></div>
                      <div><span className="text-foreground">sandbox.toml</span> <span className="text-muted-foreground/60 ml-2">— environment config</span></div>
                      <div><span className="text-foreground">inputs.toml</span> <span className="text-muted-foreground/60 ml-2">— customer settings</span></div>
                      <div className="text-foreground font-medium mt-1">components/</div>
                      <div className="pl-4 space-y-0.5">
                        <div><span className="text-muted-foreground">1-rds.toml</span> <span className="text-muted-foreground/60 ml-2">— managed database</span></div>
                        <div><span className="text-muted-foreground">2-your-app.toml</span> <span className="text-muted-foreground/60 ml-2">— Helm release</span></div>
                        <div><span className="text-muted-foreground">values/values.yaml</span> <span className="text-muted-foreground/60 ml-2">— templated values</span></div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Community configs */}
      {communityConfigs.length > 0 && (
        <div className="mt-14 sm:mt-20">
          <div className="flex items-center gap-2 mb-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Recently generated
            </div>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden">
            {communityConfigs.map((config) => (
              <button
                key={`${config.full_name}-${config.chart_name}`}
                onClick={() => { trackEvent("repo_selected", { repo_name: config.full_name, source: "recent" }); resolveAndGo(config.html_url); }}
                className="text-left px-5 py-4 bg-card hover:bg-muted/30 transition-all group flex items-start gap-3"
              >
                <Package className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-base font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    {config.chart_name}
                  </div>
                  <div className="text-sm text-muted-foreground truncate mt-0.5">
                    {config.full_name}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Nuon CTA */}
      <div className="mt-14 sm:mt-20 max-w-xl lg:max-w-3xl mx-auto">
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-base font-medium text-foreground mb-1">
              New to Nuon?
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Nuon is the deployment platform for software vendors who want to ship to customer clouds — one pipeline, every environment, secure by default.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="https://docs.nuon.co/get-started/quickstart"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Quickstart
            </a>
            <a
              href="https://nuon.co"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Learn more
            </a>
          </div>
        </div>
      </div>

      {/* Config counter */}
      {configCount > 0 && (
        <p className="text-center text-sm text-muted-foreground mt-8">
          {configCount.toLocaleString()} Nuon config{configCount !== 1 ? "s" : ""} generated so far
        </p>
      )}
    </div>
  );
}
