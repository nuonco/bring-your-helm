import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { codeToHtml } from "shiki";
import { generateNuonConfig } from "@/lib/nuon";
import { useTheme } from "@/hooks/use-theme";
import type { GitHubRepo, HelmChart } from "@/lib/types";
import { ArrowLeft, Copy, Check, Download, ChevronsDown, ExternalLink } from "lucide-react";

interface StepGenerateProps {
  repo: GitHubRepo;
  chart: HelmChart;
  valuesYaml: string;
  onBack: () => void;
  onReset: () => void;
  onGenerated: () => void;
}

export function StepGenerate({ repo, chart, valuesYaml, onBack, onReset, onGenerated }: StepGenerateProps) {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);
  const filename = `${chart.name}-component.toml`;

  const handleScroll = useCallback(() => {
    const el = codeRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    setIsScrolledToBottom(atBottom);
  }, []);

  const config = useMemo(
    () => generateNuonConfig(repo.html_url, chart.path, chart.name, valuesYaml),
    [repo, chart, valuesYaml]
  );

  useEffect(() => {
    codeToHtml(config, {
      lang: "toml",
      theme: "github-dark",
    }).then(setHighlightedHtml);
  }, [config]);

  useEffect(() => {
    onGenerated();
    try {
      const entry = {
        full_name: repo.full_name,
        html_url: repo.html_url,
        description: repo.description,
        chart_name: chart.name,
        chart_path: chart.path,
        ts: Date.now(),
      };
      const existing = JSON.parse(localStorage.getItem("byocify-community") || "[]");
      const deduped = existing.filter((e: any) => !(e.full_name === entry.full_name && e.chart_name === entry.chart_name));
      const updated = [entry, ...deduped].slice(0, 20);
      localStorage.setItem("byocify-community", JSON.stringify(updated));
    } catch { /* ignore storage errors */ }
  }, []);

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
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="text-center mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-medium text-foreground mb-1.5">
          Your config is ready
        </h2>
        <p className="text-base text-muted-foreground">
          Add this to your Nuon app repo and you're live
        </p>
      </div>

      <div className="rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="flex items-center px-4 py-2.5 border-b border-border bg-muted/20 gap-2">
          <span className="text-sm font-mono text-muted-foreground truncate min-w-0">
            {chart.path}/{filename}
          </span>
          <div className="flex-1 shrink-0" />
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-primary" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </button>
        </div>

        <div className="relative bg-[#24292e] dark:bg-[#0d1117]">
          <div
            ref={codeRef}
            onScroll={handleScroll}
            className="max-h-[400px] overflow-auto text-sm [&_pre]:!bg-transparent [&_pre]:px-5 [&_pre]:py-4 [&_pre]:m-0 [&_code]:text-[14px] [&_code]:leading-[1.7] [&_.line]:block"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
          {!isScrolledToBottom && highlightedHtml && (
            <div className="absolute bottom-0 left-0 right-0 pointer-events-none flex flex-col items-center">
              <div className="w-full h-12 bg-gradient-to-t from-[#24292e] dark:from-[#0d1117] to-transparent" />
              <div className="pointer-events-auto -mt-6 mb-2 flex items-center gap-1 text-[11px] text-white/50 animate-pulse">
                <ChevronsDown className="w-3.5 h-3.5" />
                Scroll for more
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3 mt-5">
        <button
          onClick={handleDownload}
          className="flex-1 py-3 rounded-xl border border-border bg-card text-foreground text-base font-medium flex items-center justify-center gap-2 hover:bg-muted transition-colors"
        >
          <Download className="w-4 h-4" />
          <span className="truncate">Download config</span>
        </button>
        <a
          href="https://app.nuon.co"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-base font-medium flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
        >
          Deploy with Nuon
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="flex items-center justify-between mt-6 sm:mt-8">
        <button onClick={onBack} className="text-base text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 group">
          <span className="w-7 h-7 rounded-full border border-border group-hover:border-foreground/30 group-hover:bg-muted flex items-center justify-center transition-all">
            <ArrowLeft className="w-3.5 h-3.5" />
          </span>
          Back
        </button>
        <button onClick={onReset} className="text-base text-muted-foreground hover:text-foreground transition-colors">
          Start over
        </button>
      </div>
    </div>
  );
}
