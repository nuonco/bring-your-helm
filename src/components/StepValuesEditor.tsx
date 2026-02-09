import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { getFileContent } from "@/lib/github";
import { NUON_VARIABLES } from "@/lib/nuon";
import type { GitHubRepo, HelmChart, WizardAction } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader2, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepValuesEditorProps {
  repo: GitHubRepo;
  chart: HelmChart;
  valuesYaml: string;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}

export function StepValuesEditor({ repo, chart, valuesYaml, dispatch, onNext, onBack }: StepValuesEditorProps) {
  const [loading, setLoading] = useState(!valuesYaml);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);

  useEffect(() => {
    if (valuesYaml) return;
    const [owner, name] = repo.full_name.split("/");
    getFileContent(owner, name, `${chart.path}/values.yaml`)
      .then((content) => {
        dispatch({ type: "SET_VALUES", yaml: content });
      })
      .catch(() => {
        dispatch({ type: "SET_VALUES", yaml: "# No values.yaml found — start from scratch\n" });
      })
      .finally(() => setLoading(false));
  }, [repo, chart, valuesYaml, dispatch]);

  const copyVariable = (template: string) => {
    navigator.clipboard.writeText(template);
    setCopiedVar(template);
    setTimeout(() => setCopiedVar(null), 1500);
  };

  const categories = [...new Set(NUON_VARIABLES.map((v) => v.category))];

  if (loading) {
    return (
      <div className="flex flex-col items-center py-16 gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Loading values.yaml...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">Configure Values</h2>
        <p className="text-muted-foreground text-sm">
          Edit your <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">values.yaml</code> and
          wire in Nuon variables to make your chart BYOC-ready.
        </p>
      </div>

      <div className="flex gap-4 h-[500px]">
        {/* Editor */}
        <div className="flex-1 rounded-lg border border-border overflow-hidden">
          <Editor
            defaultLanguage="yaml"
            value={valuesYaml}
            onChange={(value) => dispatch({ type: "SET_EDITED_VALUES", yaml: value || "" })}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              padding: { top: 12 },
              wordWrap: "on",
            }}
          />
        </div>

        {/* Variable reference panel */}
        <div className="w-64 shrink-0 rounded-lg border border-border bg-card overflow-y-auto">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Nuon Variables</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Click to copy</p>
          </div>
          <div className="p-2 space-y-3">
            {categories.map((cat) => (
              <div key={cat}>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                  {cat}
                </div>
                {NUON_VARIABLES.filter((v) => v.category === cat).map((v) => (
                  <button
                    key={v.template}
                    onClick={() => copyVariable(v.template)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent/50 transition-colors group",
                    )}
                    title={v.description}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-foreground font-medium">{v.name}</span>
                      {copiedVar === v.template ? (
                        <Check className="w-3 h-3 text-primary" />
                      ) : (
                        <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate">
                      {v.template}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={onNext}>
          Generate Config
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
