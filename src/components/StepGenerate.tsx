import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { generateNuonConfig } from "@/lib/nuon";
import type { GitHubRepo, HelmChart } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, Download, Check, RotateCcw } from "lucide-react";

interface StepGenerateProps {
  repo: GitHubRepo;
  chart: HelmChart;
  valuesYaml: string;
  onBack: () => void;
  onReset: () => void;
}

export function StepGenerate({ repo, chart, valuesYaml, onBack, onReset }: StepGenerateProps) {
  const [copied, setCopied] = useState(false);

  const config = useMemo(
    () => generateNuonConfig(repo.html_url, chart.path, chart.name, valuesYaml),
    [repo, chart, valuesYaml]
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${chart.name}-component.toml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">Your Nuon Config</h2>
        <p className="text-muted-foreground text-sm">
          Here's your generated component configuration. Copy it or download to add to your Nuon app.
        </p>
      </div>

      <div className="rounded-lg border border-border overflow-hidden h-[400px]">
        <Editor
          defaultLanguage="toml"
          value={config}
          theme="vs-dark"
          options={{
            readOnly: true,
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

      <div className="flex gap-3 mt-6">
        <Button onClick={handleCopy} variant="outline">
          {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
          {copied ? "Copied!" : "Copy to Clipboard"}
        </Button>
        <Button onClick={handleDownload}>
          <Download className="w-4 h-4 mr-2" />
          Download .toml
        </Button>
      </div>

      {/* Next steps */}
      <div className="mt-8 p-4 rounded-lg bg-accent/30 border border-border">
        <h3 className="text-sm font-semibold text-foreground mb-2">Next steps</h3>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Add this file to your Nuon app repository</li>
          <li>Run <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">nuon apps create</code> to create your app</li>
          <li>Configure installs and deploy to your customers' clouds</li>
        </ol>
      </div>

      <div className="flex justify-between mt-6">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="w-4 h-4 mr-2" />
          Start Over
        </Button>
      </div>
    </div>
  );
}
