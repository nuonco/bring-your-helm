import { useEffect, useState, useMemo } from "react";
import { getFileContent, fetchChartFiles } from "@/lib/github";
import { detectInfraDeps } from "@/lib/nuon";
import { searchArtifactHub, pickBestMatch } from "@/lib/artifacthub";
import type { GitHubRepo, HelmChart, WizardAction, ConfigOptions, ChartFile, ArtifactHubMatch, ChartSource } from "@/lib/types";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Info,
  FileText,
  Folder,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const INFRA_DEP_OPTIONS = [
  { id: "postgresql", label: "PostgreSQL (RDS)" },
  { id: "mysql", label: "MySQL (RDS)" },
  { id: "redis", label: "Redis (ElastiCache)" },
  { id: "minio", label: "S3 Bucket" },
] as const;

interface StepValuesEditorProps {
  repo: GitHubRepo;
  chart: HelmChart;
  valuesYaml: string;
  configOptions: ConfigOptions;
  chartFiles: ChartFile[];
  helmRepoMatches: ArtifactHubMatch[];
  helmRepoLoading: boolean;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}

export function StepValuesEditor({
  repo,
  chart,
  valuesYaml,
  configOptions,
  chartFiles,
  helmRepoMatches,
  helmRepoLoading,
  dispatch,
  onNext,
  onBack,
}: StepValuesEditorProps) {
  const [loading, setLoading] = useState(!valuesYaml);
  const [chartFilesLoading, setChartFilesLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isMonorepo = useMemo(() => {
    const p = chart.path || ".";
    return p !== "." && p.includes("/");
  }, [chart.path]);

  const autoDetectedDeps = useMemo(
    () => detectInfraDeps(chart.dependencies || []),
    [chart.dependencies]
  );

  // Auto-detect ArtifactHub match on mount
  useEffect(() => {
    if (helmRepoMatches.length > 0) return; // already searched
    dispatch({ type: "SET_HELM_REPO_LOADING", loading: true });
    searchArtifactHub(chart.name)
      .then((matches) => {
        dispatch({ type: "SET_HELM_REPO_MATCHES", matches });
        const best = pickBestMatch(matches, chart.name, repo.owner.login);
        if (best) {
          dispatch({ type: "SET_CONFIG_OPTIONS", options: { chartSource: { type: "helm_repo", match: best } } });
        } else if (isMonorepo) {
          // No ArtifactHub match + monorepo → bundle by default
          handleEnableBundle();
        }
      })
      .catch(() => {
        // ArtifactHub search failed — fall back
        if (isMonorepo) handleEnableBundle();
      })
      .finally(() => {
        dispatch({ type: "SET_HELM_REPO_LOADING", loading: false });
      });
  }, [chart.name]);

  useEffect(() => {
    if (autoDetectedDeps.length > 0 && configOptions.infraDeps.length === 0) {
      dispatch({ type: "SET_CONFIG_OPTIONS", options: { infraDeps: autoDetectedDeps } });
    }
  }, [autoDetectedDeps, configOptions.infraDeps.length, dispatch]);

  const handleEnableBundle = async () => {
    dispatch({ type: "SET_CONFIG_OPTIONS", options: { chartSource: { type: "bundle" } } });
    if (chartFiles.length > 0) return;
    setChartFilesLoading(true);
    try {
      const [owner, name] = repo.full_name.split("/");
      const files = await fetchChartFiles(owner, name, chart.path);
      dispatch({ type: "SET_CHART_FILES", files });
    } catch (err) {
      console.error("Failed to fetch chart files:", err);
    } finally {
      setChartFilesLoading(false);
    }
  };

  const setChartSource = (source: ChartSource) => {
    dispatch({ type: "SET_CONFIG_OPTIONS", options: { chartSource: source } });
    if (source.type === "bundle" && chartFiles.length === 0) {
      handleEnableBundle();
    }
  };

  const toggleInfraDep = (depId: string) => {
    const current = configOptions.infraDeps;
    const next = current.includes(depId)
      ? current.filter((d) => d !== depId)
      : [...current, depId];
    dispatch({ type: "SET_CONFIG_OPTIONS", options: { infraDeps: next } });
  };

  useEffect(() => {
    if (valuesYaml) return;
    const [owner, name] = repo.full_name.split("/");
    getFileContent(owner, name, `${chart.path}/values.yaml`)
      .then((content) => dispatch({ type: "SET_VALUES", yaml: content }))
      .catch(() =>
        dispatch({
          type: "SET_VALUES",
          yaml: "# No values.yaml found — start from scratch\n",
        })
      )
      .finally(() => setLoading(false));
  }, [repo, chart, valuesYaml, dispatch]);

  const depCount = configOptions.infraDeps.length;
  const toolbarSubtitle = depCount > 0
    ? `${depCount} infrastructure dependenc${depCount === 1 ? "y" : "ies"} detected from this chart — review and adjust below`
    : "Choose your cloud provider and infrastructure, then hit Generate";

  const summaryItems = useMemo(() => {
    const items: { label: string; desc: string }[] = [
      { label: "metadata.toml, sandbox.toml, runner.toml", desc: "App identity, sandbox environment, and runner config" },
      { label: "inputs.toml", desc: "Customer-facing settings (subdomain, passwords, etc.)" },
    ];
    const hasDb = configOptions.infraDeps.some((d) => ["postgresql", "mysql", "mariadb"].includes(d));
    const hasCache = configOptions.infraDeps.some((d) => ["redis", "memcached"].includes(d));
    const hasS3 = configOptions.infraDeps.some((d) => ["minio", "s3"].includes(d));
    let n = 1;
    if (hasDb) { items.push({ label: `${n}-rds.toml + Terraform`, desc: "Provisions a managed database in the customer's cloud" }); n++; }
    if (hasCache) { items.push({ label: `${n}-elasticache.toml + Terraform`, desc: "Provisions a managed cache in the customer's cloud" }); n++; }
    if (hasS3) { items.push({ label: `${n}-s3.toml + Terraform`, desc: "Provisions object storage in the customer's cloud" }); n++; }
    items.push({ label: `${n}-${chart.name}.toml`, desc: "Helm release — deploys your app" });
    items.push({ label: "values.yaml", desc: "Helm values with Nuon template variables wired in" });
    if (hasDb) items.push({ label: "db-credentials action", desc: "Copies database secrets into Kubernetes after provisioning" });
    return items;
  }, [configOptions.infraDeps, chart.name]);

  // Find the best ArtifactHub match for display
  const bestMatch = useMemo(
    () => pickBestMatch(helmRepoMatches, chart.name, repo.owner.login),
    [helmRepoMatches, chart.name, repo.owner.login]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center text-center">
          <Loader2 className="w-5 h-5 text-primary animate-spin mb-4" />
          <p className="text-base text-muted-foreground">Loading values...</p>
        </div>
      </div>
    );
  }

  const appDirName = (configOptions.namespace || chart.name).toLowerCase().replace(/[^a-z0-9-]/g, "-");

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="text-base text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <span className="text-border shrink-0">|</span>
          <div className="min-w-0">
            <span className="text-base font-mono text-foreground truncate block">
              Configure
            </span>
            <span className="text-sm text-muted-foreground hidden sm:block">
              {toolbarSubtitle}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

          {/* Row 1: Primary configuration tiles */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Cloud Provider */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-sm font-semibold text-foreground">Cloud Provider</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs leading-relaxed">
                    The cloud where your customers' instances will run. Each install gets its own isolated infrastructure.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="space-y-1">
                {([["aws", "AWS (EKS)"], ["azure", "Azure (AKS)"]] as const).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer hover:bg-muted/40 transition-colors">
                    <input
                      type="radio"
                      name="cloudProvider"
                      checked={configOptions.cloudProvider === value}
                      onChange={() => dispatch({ type: "SET_CONFIG_OPTIONS", options: { cloudProvider: value } })}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Infrastructure Mode */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-sm font-semibold text-foreground">Infrastructure Mode</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                    Controls whether Nuon creates a new VPC for each install or deploys into one the customer provides.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="space-y-1">
                {([
                  ["default", "Default", "New VPC, subnets, and cluster per install"],
                  ["bring-vpc", "Bring own VPC", "Deploy into customer's existing VPC"],
                ] as const).map(([value, label, desc]) => (
                  <label key={value} className="flex flex-col px-2 py-2 rounded-lg cursor-pointer hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="infraMode"
                        checked={configOptions.infraMode === value}
                        onChange={() => dispatch({ type: "SET_CONFIG_OPTIONS", options: { infraMode: value } })}
                        className="accent-primary"
                      />
                      <span className="text-sm text-foreground">{label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground ml-[26px] mt-0.5">{desc}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Infrastructure Dependencies */}
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-1.5 mb-1">
                <h3 className="text-sm font-semibold text-foreground">Infrastructure Dependencies</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
                    Cloud-managed services your app needs. Nuon provisions these in each customer's cloud account alongside your app.
                  </TooltipContent>
                </Tooltip>
              </div>
              {autoDetectedDeps.length > 0 && (
                <p className="text-xs text-primary mb-2">
                  {autoDetectedDeps.length} auto-detected — uncheck any you don't need
                </p>
              )}
              {autoDetectedDeps.length === 0 && (
                <p className="text-xs text-muted-foreground mb-2">
                  Select managed services to provision per customer
                </p>
              )}
              <div className="space-y-1">
                {INFRA_DEP_OPTIONS.map((dep) => {
                  const checked = configOptions.infraDeps.includes(dep.id);
                  const isAutoDetected = autoDetectedDeps.includes(dep.id);
                  return (
                    <label key={dep.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-muted/40 transition-colors">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleInfraDep(dep.id)}
                        className="accent-primary"
                      />
                      <span className="text-sm text-foreground">{dep.label}</span>
                      {isAutoDetected && (
                        <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded ml-auto">auto</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 2: Secondary configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Namespace */}
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-1">Namespace</h3>
              <p className="text-xs text-muted-foreground mb-3">
                The Kubernetes namespace for your app in each customer's cluster.
              </p>
              <input
                type="text"
                value={configOptions.namespace}
                onChange={(e) => dispatch({ type: "SET_CONFIG_OPTIONS", options: { namespace: e.target.value } })}
                placeholder={chart.name}
                className="w-full h-9 px-3 text-sm bg-background border border-border rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>

            {/* Config Repository */}
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-semibold text-foreground mb-1">Config Repository</h3>
              <p className="text-xs text-muted-foreground mb-3">
                The GitHub repo where you'll store these files. Nuon syncs from this repo to deploy your app.
                {!configOptions.configRepo && (
                  <span className="text-muted-foreground/60"> Leave blank to fill in later.</span>
                )}
              </p>
              <input
                type="text"
                value={configOptions.configRepo}
                onChange={(e) => dispatch({ type: "SET_CONFIG_OPTIONS", options: { configRepo: e.target.value } })}
                placeholder="your-org/your-repo"
                className="w-full h-9 px-3 text-sm font-mono bg-background border border-border rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>
          </div>

          {/* Row 3: Chart Source */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-1.5 mb-1">
              <h3 className="text-sm font-semibold text-foreground">Chart Source</h3>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3.5 h-3.5 text-muted-foreground/60 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
                  Controls where the Nuon runner fetches the Helm chart from at deploy time.
                </TooltipContent>
              </Tooltip>
            </div>

            {helmRepoLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Looking up chart on ArtifactHub...
              </div>
            ) : configOptions.chartSource.type === "helm_repo" ? (
              <>
                {/* Helm repo match — clean confirmation */}
                <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <ExternalLink className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span>
                      Chart will be pulled from{" "}
                      <code className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">
                        {configOptions.chartSource.match.repoUrl}
                      </code>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 ml-[22px]">
                    {configOptions.chartSource.match.name} v{configOptions.chartSource.match.version} — from {configOptions.chartSource.match.repoName}
                  </p>
                </div>

                {/* Advanced options disclosure */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn("w-3 h-3 transition-transform", showAdvanced && "rotate-180")} />
                  Advanced options
                </button>
                {showAdvanced && (
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className={cn(
                      "flex items-start gap-2.5 px-3 py-3 rounded-lg border cursor-pointer transition-colors",
                      "border-border hover:bg-muted/40"
                    )}>
                      <input
                        type="radio"
                        name="chartSourceAlt"
                        checked={false}
                        onChange={() => setChartSource({ type: "upstream_repo" })}
                        className="accent-primary mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-foreground">Upstream repo</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Clone from <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded">{repo.full_name}</code>
                        </p>
                      </div>
                    </label>
                    <label className={cn(
                      "flex items-start gap-2.5 px-3 py-3 rounded-lg border cursor-pointer transition-colors",
                      "border-border hover:bg-muted/40"
                    )}>
                      <input
                        type="radio"
                        name="chartSourceAlt"
                        checked={false}
                        onChange={() => setChartSource({ type: "bundle" })}
                        className="accent-primary mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-foreground">Bundle into config repo</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Include chart files in the ZIP
                        </p>
                      </div>
                    </label>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* No ArtifactHub match — show fallback notice + toggle */}
                {bestMatch === null && helmRepoMatches.length === 0 && !helmRepoLoading && (
                  <p className="text-xs text-muted-foreground mb-3">
                    {isMonorepo
                      ? "This chart lives in a large repository. Bundling avoids slow build clones."
                      : "No Helm repository found for this chart. Choose where the runner fetches it at deploy time."}
                  </p>
                )}
                {bestMatch === null && helmRepoMatches.length > 0 && (
                  <p className="text-xs text-muted-foreground mb-3">
                    No exact Helm repository match found. Choose how to fetch the chart at deploy time.
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={cn(
                    "flex items-start gap-2.5 px-3 py-3 rounded-lg border cursor-pointer transition-colors",
                    configOptions.chartSource.type === "upstream_repo" ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40"
                  )}>
                    <input
                      type="radio"
                      name="chartSource"
                      checked={configOptions.chartSource.type === "upstream_repo"}
                      onChange={() => setChartSource({ type: "upstream_repo" })}
                      className="accent-primary mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-foreground">Upstream repo</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Runner clones <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded">{repo.full_name}</code>
                      </p>
                    </div>
                  </label>
                  <label className={cn(
                    "flex items-start gap-2.5 px-3 py-3 rounded-lg border cursor-pointer transition-colors",
                    configOptions.chartSource.type === "bundle" ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40"
                  )}>
                    <input
                      type="radio"
                      name="chartSource"
                      checked={configOptions.chartSource.type === "bundle"}
                      onChange={() => setChartSource({ type: "bundle" })}
                      className="accent-primary mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        Bundle into config repo
                        {isMonorepo && (
                          <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded ml-2">recommended</span>
                        )}
                      </span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Chart files included in the ZIP — runner clones your config repo
                      </p>
                    </div>
                  </label>
                </div>
              </>
            )}
            {chartFilesLoading && (
              <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Fetching chart files...
              </div>
            )}
            {configOptions.chartSource.type === "bundle" && chartFiles.length > 0 && !chartFilesLoading && (
              <p className="text-xs text-primary mt-3">
                {chartFiles.length} chart file(s) will be bundled
              </p>
            )}
          </div>

          {/* Generate CTA */}
          <div className="flex justify-end">
            <button
              onClick={onNext}
              className="flex items-center gap-2 px-6 h-11 rounded-xl bg-primary text-primary-foreground text-base font-semibold hover:bg-primary/90 transition-colors shadow-sm"
            >
              Generate config
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Will Generate summary */}
          <div className="rounded-xl border border-border bg-muted/20 p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">What you'll get</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
              {summaryItems.map((item) => (
                <div key={item.label} className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    {item.label.includes("/") || item.label.includes("action") ? (
                      <Folder className="w-3.5 h-3.5 text-primary/60" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-primary/60" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground font-mono">{item.label}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border/60">
              <p className="text-xs text-muted-foreground">
                Files will be packaged as <span className="font-mono font-medium text-foreground">{appDirName}/</span> — ready to push to GitHub and sync with Nuon.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
