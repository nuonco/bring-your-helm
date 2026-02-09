import { useEffect, useState } from "react";
import { findHelmCharts } from "@/lib/github";
import type { GitHubRepo, HelmChart, WizardAction } from "@/lib/types";
import { Loader2, FileCode, ArrowLeft, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface StepHelmDetectionProps {
  repo: GitHubRepo;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}

export function StepHelmDetection({ repo, dispatch, onNext, onBack }: StepHelmDetectionProps) {
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<HelmChart[]>([]);
  const [selected, setSelected] = useState<HelmChart | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const [owner, name] = repo.full_name.split("/");
    setLoading(true);
    setError(null);
    findHelmCharts(owner, name)
      .then((found) => {
        setCharts(found);
        dispatch({ type: "SET_CHARTS", charts: found });
        if (found.length === 1) setSelected(found[0]);
      })
      .catch(() => setError("Failed to scan repository. It may be too large or rate-limited."))
      .finally(() => setLoading(false));
  }, [repo, dispatch]);

  const handleContinue = () => {
    if (!selected) return;
    dispatch({ type: "SELECT_CHART", chart: selected });
    onNext();
  };

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Helm Chart Detection</h2>
        <p className="text-muted-foreground">
          Scanning <span className="font-medium text-foreground">{repo.full_name}</span> for Helm charts...
        </p>
      </div>

      {loading && (
        <div className="flex flex-col items-center py-16 gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Searching for Chart.yaml files...</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive mb-6">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && charts.length === 0 && (
        <div className="text-center py-16">
          <FileCode className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-2">No Helm charts found in this repository.</p>
          <p className="text-sm text-muted-foreground">
            Make sure the repo contains a <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">Chart.yaml</code> file.
          </p>
        </div>
      )}

      {!loading && charts.length > 0 && (
        <div className="space-y-3">
          {charts.map((chart) => (
            <button
              key={chart.path}
              onClick={() => setSelected(chart)}
              className={cn(
                "w-full text-left p-4 rounded-lg border transition-all",
                selected?.path === chart.path
                  ? "border-primary bg-accent/50 shadow-sm"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <div className="flex items-start gap-3">
                <FileCode className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground">{chart.name}</div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{chart.path}/</div>
                  {chart.description && (
                    <div className="text-sm text-muted-foreground mt-1">{chart.description}</div>
                  )}
                </div>
                <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full shrink-0">
                  v{chart.version}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex justify-between mt-8">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={handleContinue} disabled={!selected}>
          Continue
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
