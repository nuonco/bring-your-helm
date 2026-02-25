import { useEffect, useState, useMemo } from "react";
import Editor from "@monaco-editor/react";
import { getFileContent } from "@/lib/github";
import { NUON_VARIABLES, detectInfraDeps, generateValuesFile } from "@/lib/nuon";
import type { GitHubRepo, HelmChart, WizardAction, ConfigOptions } from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  EyeOff,
  CheckCircle2,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
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
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}

export function StepValuesEditor({
  repo,
  chart,
  valuesYaml,
  configOptions,
  dispatch,
  onNext,
  onBack,
}: StepValuesEditorProps) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(!valuesYaml);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<"variables" | "configure" | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showVariables, setShowVariables] = useState(true);

  const autoDetectedDeps = useMemo(
    () => detectInfraDeps(chart.dependencies || []),
    [chart.dependencies]
  );

  useEffect(() => {
    if (autoDetectedDeps.length > 0 && configOptions.infraDeps.length === 0) {
      dispatch({ type: "SET_CONFIG_OPTIONS", options: { infraDeps: autoDetectedDeps } });
    }
  }, [autoDetectedDeps, configOptions.infraDeps.length, dispatch]);

  const valuesPreview = useMemo(
    () => generateValuesFile(chart.name || "app", valuesYaml || null, configOptions.infraDeps),
    [chart.name, valuesYaml, configOptions.infraDeps]
  );

  const copyToClipboard = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedVar(text);
    setTimeout(() => setCopiedVar(null), 1200);
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

  const categories = [...new Set(NUON_VARIABLES.map((v) => v.category))];

  // Compute "Will generate" summary
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

  const variablesContent = (
    <div className="p-3 space-y-5">
      {categories.map((cat) => (
        <div key={cat}>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
            {cat}
          </div>
          <div className="space-y-1.5">
            {NUON_VARIABLES.filter((v) => v.category === cat).map((v) => (
              <div
                key={v.template}
                className={cn(
                  "group rounded-lg border px-3 py-2.5 transition-all cursor-pointer",
                  copiedVar === v.template
                    ? "border-primary/40 bg-primary/5"
                    : "border-transparent hover:border-border hover:bg-muted/40"
                )}
                onClick={(e) => copyToClipboard(v.template, e as any)}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-foreground">
                    {v.name}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(v.template, e); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy to clipboard"
                  >
                    {copiedVar === v.template ? (
                      <Check className="w-3.5 h-3.5 text-primary" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div
                  className="font-mono text-xs text-muted-foreground bg-muted/60 rounded-md px-2.5 py-2 select-all break-all leading-relaxed transition-colors group-hover:bg-muted"
                  title="Click to copy"
                >
                  {v.template}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const configureContent = (
    <div className="p-4 space-y-5">
      {/* Cloud Provider */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Cloud Provider
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px] text-xs leading-relaxed">
              The cloud where your customers' instances will run. Each install gets its own isolated infrastructure.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="space-y-0.5">
          {([["aws", "AWS (EKS)"], ["azure", "Azure (AKS)"]] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2.5 px-1 py-1.5 rounded cursor-pointer hover:bg-muted/40 transition-colors">
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
          <label className="flex items-center gap-2.5 px-1 py-1.5 rounded opacity-50 cursor-not-allowed">
            <input type="radio" name="cloudProvider" disabled className="accent-primary" />
            <span className="text-sm text-foreground">GCP (GKE)</span>
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded ml-auto">coming soon</span>
          </label>
        </div>
      </div>

      {/* Infrastructure Mode */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Infrastructure Mode
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[240px] text-xs leading-relaxed">
              Controls whether Nuon creates a new VPC for each install or deploys into one the customer provides.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="space-y-1">
          {([
            ["default", "Default", "Nuon creates a new VPC, subnets, and cluster per install"],
            ["bring-vpc", "Bring own VPC", "Customer provides their existing VPC — you deploy into it"],
          ] as const).map(([value, label, desc]) => (
            <label key={value} className="flex flex-col px-1 py-1.5 rounded cursor-pointer hover:bg-muted/40 transition-colors">
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
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Infrastructure Dependencies
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 text-muted-foreground/60 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[260px] text-xs leading-relaxed">
              Cloud-managed services your app needs. Nuon provisions these in each customer's cloud account alongside your app.
            </TooltipContent>
          </Tooltip>
        </div>
        {autoDetectedDeps.length > 0 && (
          <p className="text-xs text-primary mb-2">
            {autoDetectedDeps.length} auto-detected — uncheck any you don't need
          </p>
        )}
        <div className="space-y-1.5">
          {INFRA_DEP_OPTIONS.map((dep) => {
            const checked = configOptions.infraDeps.includes(dep.id);
            const isAutoDetected = autoDetectedDeps.includes(dep.id);
            return (
              <label key={dep.id} className="flex items-center gap-2.5 px-1 py-1.5 rounded cursor-pointer hover:bg-muted/40 transition-colors">
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

      {/* Namespace */}
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Namespace
        </div>
        <p className="text-xs text-muted-foreground mb-2">
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
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Config Repository
        </div>
        <p className="text-xs text-muted-foreground mb-2">
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

      {/* Will Generate summary */}
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Will generate
        </div>
        <div className="space-y-1">
          {summaryItems.map((item) => (
            <div key={item.label} className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3 h-3 text-primary/60 mt-0.5 shrink-0" />
              <div>
                <span className="text-foreground font-medium">{item.label}</span>
                <span className="ml-1">— {item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 shrink-0 border-b border-border">
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
              Configure &amp; Preview
            </span>
            <span className="text-sm text-muted-foreground hidden sm:block">
              {toolbarSubtitle}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={cn(
              "hidden md:flex items-center gap-1.5 px-3 h-9 rounded-lg border text-sm font-medium transition-colors",
              showPreview
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:bg-muted"
            )}
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{showPreview ? "Hide preview" : "Preview output"}</span>
          </button>
          <button
            onClick={onNext}
            className="flex items-center gap-1.5 px-4 sm:px-5 h-9 rounded-lg bg-primary text-primary-foreground text-base font-medium hover:bg-primary/90 transition-colors shrink-0"
          >
            Generate config
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Desktop: resizable layout — Configure | Preview | Variables */}
      <div className="hidden md:flex flex-1 min-h-0 bg-card">
        <ResizablePanelGroup
          direction="horizontal"
          key={`${showPreview ? "p" : ""}${showVariables ? "v" : ""}`}
        >
          <ResizablePanel defaultSize={showPreview ? 22 : 50} minSize={16}>
            <div className="flex flex-col h-full">
              <div className="flex items-center px-4 h-10 border-b border-border bg-muted/20 shrink-0">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Configure
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="px-4 pt-3 pb-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    These settings determine what cloud infrastructure Nuon provisions for each customer install.
                    {" "}<a href="https://docs.nuon.co/configuration-files" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Config file reference</a>
                  </p>
                </div>
                {configureContent}
              </div>
            </div>
          </ResizablePanel>

          {showPreview && (
            <>
              <ResizableHandle />
              <ResizablePanel
                defaultSize={showVariables ? 56 : 78}
                minSize={30}
              >
                <div className="flex flex-col h-full border-l border-border">
                  <div className="flex items-center px-4 h-10 border-b border-border bg-muted/20 shrink-0">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Generated values.yaml preview
                    </span>
                  </div>
                  <div className="flex-1 min-h-0">
                    <Editor
                      defaultLanguage="yaml"
                      value={valuesPreview.content}
                      theme={theme === "dark" ? "vs-dark" : "vs"}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        fontSize: 14,
                        fontFamily: "'Hack', monospace",
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        padding: { top: 12 },
                        wordWrap: "on",
                        renderLineHighlight: "none",
                        overviewRulerLanes: 0,
                        hideCursorInOverviewRuler: true,
                        scrollbar: {
                          verticalScrollbarSize: 6,
                          horizontalScrollbarSize: 6,
                        },
                      }}
                    />
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}

          <ResizableHandle />

          {showVariables ? (
            <ResizablePanel defaultSize={22} minSize={14}>
              <div className="flex flex-col h-full border-l border-border">
                <div className="flex items-center justify-between px-4 h-10 border-b border-border bg-muted/20 shrink-0">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Variables
                  </span>
                  <button
                    onClick={() => setShowVariables(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Collapse variables"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Template variables reference dynamic values (like the customer's region or database endpoint) in your config files. Click to copy.
                    </p>
                  </div>
                  {variablesContent}
                </div>
              </div>
            </ResizablePanel>
          ) : (
            <ResizablePanel defaultSize={2} minSize={2} maxSize={2}>
              <button
                onClick={() => setShowVariables(true)}
                className="h-full w-full flex items-center justify-center border-l border-border bg-muted/20 hover:bg-muted/40 transition-colors"
                title="Expand variables"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Mobile: stacked layout */}
      <div className="flex flex-col md:hidden flex-1 min-h-0">
        <div className="flex-1 min-h-[200px] bg-card p-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{toolbarSubtitle}</p>
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Will generate
              </div>
              <div className="space-y-1">
                {summaryItems.map((item) => (
                  <div key={item.label} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3 h-3 text-primary/60 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-foreground font-medium">{item.label}</span>
                      <span className="ml-1">— {item.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible: Configure */}
        <div className="border-t border-border bg-card">
          <button
            onClick={() => setMobileSection(mobileSection === "configure" ? null : "configure")}
            className="w-full flex items-center justify-between px-4 h-10 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/20"
          >
            Configure
            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", mobileSection === "configure" && "rotate-180")} />
          </button>
          {mobileSection === "configure" && (
            <div className="max-h-[350px] overflow-y-auto border-t border-border">
              {configureContent}
            </div>
          )}
        </div>

        {/* Collapsible: Template Variables */}
        <div className="border-t border-border bg-card">
          <button
            onClick={() => setMobileSection(mobileSection === "variables" ? null : "variables")}
            className="w-full flex items-center justify-between px-4 h-10 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/20"
          >
            Variables
            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", mobileSection === "variables" && "rotate-180")} />
          </button>
          {mobileSection === "variables" && (
            <div className="max-h-[250px] overflow-y-auto border-t border-border">
              {variablesContent}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
