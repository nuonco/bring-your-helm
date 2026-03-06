import { useEffect, useState } from "react";
import { findHelmCharts } from "@/lib/github";
import { trackEvent } from "@/lib/analytics";
import type { GitHubRepo, HelmChart, WizardAction } from "@/lib/types";
import { Loader2, AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";

interface StepHelmDetectionProps {
  repo: GitHubRepo;
  subpath?: string;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}

export function StepHelmDetection({ repo, subpath, dispatch, onNext, onBack }: StepHelmDetectionProps) {
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<HelmChart[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const [owner, name] = repo.full_name.split("/");
    setLoading(true);
    setError(null);
    findHelmCharts(owner, name, subpath)
      .then((found) => {
        setCharts(found);
        dispatch({ type: "SET_CHARTS", charts: found });
      })
      .catch(() => setError("Couldn't scan this repository. It may be too large or rate-limited."))
      .finally(() => setLoading(false));
  }, [repo, dispatch]);

  const handleSelect = (chart: HelmChart) => {
    trackEvent("chart_selected", {
      chart_name: chart.name,
      dependency_count: chart.dependencies?.length ?? 0,
    });
    dispatch({ type: "SELECT_CHART", chart });
    onNext();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center text-center">
        <Loader2 className="w-5 h-5 text-primary animate-spin mb-4" />
        <p className="text-base text-muted-foreground">
          Scanning <span className="text-foreground">{repo.full_name}</span> for Helm charts...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-2 text-destructive mb-6">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-base">{error}</p>
        </div>
        <button onClick={onBack} className="text-base text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 group">
          <span className="w-7 h-7 rounded-full border border-border group-hover:border-foreground/30 group-hover:bg-muted flex items-center justify-center transition-all">
            <ArrowLeft className="w-3.5 h-3.5" />
          </span>
          Try another repo
        </button>
      </div>
    );
  }

  if (charts.length === 0) {
    return (
      <div className="flex flex-col items-center text-center">
        <p className="text-base text-foreground mb-1">No Helm charts found</p>
        <p className="text-base text-muted-foreground mb-6">
          We couldn't find a <code className="font-mono text-sm">Chart.yaml</code> in this repository. Make sure it contains a Helm chart — look for a directory with <code className="font-mono text-sm">Chart.yaml</code> and a <code className="font-mono text-sm">templates/</code> folder.
        </p>
        <button onClick={onBack} className="text-base text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 group">
          <span className="w-7 h-7 rounded-full border border-border group-hover:border-foreground/30 group-hover:bg-muted flex items-center justify-center transition-all">
            <ArrowLeft className="w-3.5 h-3.5" />
          </span>
          Try another repo
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-medium text-foreground mb-1.5 break-all">
          Select a chart from {repo.full_name}
        </h2>
        <p className="text-base text-muted-foreground">
          We found {charts.length} chart{charts.length !== 1 ? "s" : ""} — pick the one that packages your application
        </p>
      </div>

      <div className="space-y-2">
        {charts.map((chart) => {
          const displayName = chart.path.split("/").pop() || chart.name;
          const hasVersion = chart.version && chart.version !== "unknown";
          return (
            <button
              key={chart.path}
              onClick={() => handleSelect(chart)}
              className="w-full text-left px-5 py-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-base font-medium text-foreground group-hover:text-primary transition-colors">{displayName}</div>
                  <div className="text-sm text-muted-foreground font-mono mt-0.5">{chart.path}/</div>
                  {chart.description && (
                    <div className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{chart.description}</div>
                  )}
                  {chart.dependencies && chart.dependencies.length > 0 && (
                    <div className="text-xs text-primary mt-1">
                      {chart.dependencies.length} dependenc{chart.dependencies.length === 1 ? "y" : "ies"} (e.g. database, cache) — we'll detect these next
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {hasVersion && (
                    <span className="hidden sm:inline text-sm font-mono text-muted-foreground">v{chart.version}</span>
                  )}
                  <div className="w-6 h-6 rounded-full border border-border group-hover:border-primary/40 group-hover:bg-primary/10 flex items-center justify-center transition-all">
                    <ArrowRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-8 text-center">
        <button onClick={onBack} className="text-base text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 mx-auto group">
          <span className="w-7 h-7 rounded-full border border-border group-hover:border-foreground/30 group-hover:bg-muted flex items-center justify-center transition-all">
            <ArrowLeft className="w-3.5 h-3.5" />
          </span>
          Different repo
        </button>
      </div>
    </div>
  );
}
