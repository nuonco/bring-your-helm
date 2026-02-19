import { useMemo, useState, useEffect, useCallback } from "react";
import { codeToHtml } from "shiki";
import { generateNuonConfig } from "@/lib/nuon";
import type { GitHubRepo, HelmChart, GeneratedFile, ConfigOptions } from "@/lib/types";
import { ArrowLeft, Copy, Check, Download, ExternalLink, FileText, Archive, Folder, FolderOpen, ChevronRight, Terminal, FolderTree, Pencil, Rocket, ShieldCheck, BookOpen, Code2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import JSZip from "jszip";

const LANG_BADGE_COLORS: Record<string, string> = {
  toml: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  yaml: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  hcl: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  json: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const SHIKI_LANG_MAP: Record<string, string> = {
  toml: "toml",
  yaml: "yaml",
  hcl: "hcl",
  json: "json",
};

interface StepGenerateProps {
  repo: GitHubRepo;
  chart: HelmChart;
  valuesYaml: string;
  configOptions: ConfigOptions;
  onBack: () => void;
  onReset: () => void;
  onGenerated: () => void;
}

interface TreeNode {
  name: string;
  path: string;
  file?: GeneratedFile;
  children: TreeNode[];
}

function buildTree(files: GeneratedFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const parts = file.filename.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      let existing = current.find((n) => n.name === name);
      if (!existing) {
        existing = { name, path, children: [], file: isFile ? file : undefined };
        current.push(existing);
      }
      current = existing.children;
    }
  }
  return root;
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  defaultOpen = true,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (file: GeneratedFile) => void;
  defaultOpen?: boolean;
}) {
  const isFolder = !node.file;
  const isSelected = node.file && node.path === selectedPath;
  const [open, setOpen] = useState(defaultOpen);

  if (isFolder) {
    return (
      <>
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-1.5 py-1 text-left transition-colors rounded-md px-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-90")} />
          {open ? (
            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate font-mono text-xs font-medium">{node.name}</span>
        </button>
        {open && node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.file!)}
      className={cn(
        "w-full flex items-center gap-1.5 py-1 text-left transition-colors rounded-md px-1",
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground hover:bg-muted/50 cursor-pointer"
      )}
      style={{ paddingLeft: `${depth * 12 + 19}px` }}
    >
      <FileText className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate font-mono text-xs">{node.name}</span>
    </button>
  );
}

function NextStep({
  number,
  icon: Icon,
  title,
  children,
  isLast,
}: {
  number: number;
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold flex items-center justify-center">
          {number}
        </div>
        {!isLast && <div className="flex-1 w-px bg-border mt-2" />}
      </div>
      <div className={cn("min-w-0", isLast ? "" : "pb-6")}>
        <div className="flex items-center gap-2 mb-2 -mt-0.5">
          <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

function CodeSnippet({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="text-xs font-mono text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 leading-relaxed overflow-x-auto pr-10">
        {text}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

export function StepGenerate({ repo, chart, valuesYaml, configOptions, onBack, onReset, onGenerated }: StepGenerateProps) {
  const files = useMemo(
    () => generateNuonConfig(repo.full_name, chart, valuesYaml, configOptions),
    [repo, chart, valuesYaml, configOptions]
  );

  const tree = useMemo(() => buildTree(files), [files]);

  const [selectedFile, setSelectedFile] = useState<GeneratedFile>(files[0]);
  const [highlighted, setHighlighted] = useState("");
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const appDirName = chart.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  useEffect(() => {
    if (!showCode) return;
    const lang = SHIKI_LANG_MAP[selectedFile.language] || "text";
    codeToHtml(selectedFile.content, { lang, theme: "github-dark" }).then(setHighlighted);
  }, [selectedFile, showCode]);

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

  const downloadZip = useCallback(async () => {
    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.filename, file.content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${chart.name}-nuon-config.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [files, chart.name]);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([selectedFile.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedFile.filename.split("/").pop() || selectedFile.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const badgeColor = LANG_BADGE_COLORS[selectedFile.language] || "bg-muted text-muted-foreground";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
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
            <span className="text-base font-medium text-foreground truncate block">
              Your config is ready
            </span>
            <span className="text-sm text-muted-foreground hidden sm:block">
              {files.length} files generated for {chart.name}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <button
            onClick={() => setShowCode(!showCode)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-9 rounded-lg border text-sm font-medium transition-colors",
              showCode
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:bg-muted"
            )}
          >
            {showCode ? <EyeOff className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{showCode ? "Hide code" : "Show code"}</span>
          </button>
          <button
            onClick={downloadZip}
            className="flex items-center gap-1.5 px-4 h-9 rounded-lg border border-border bg-card text-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <Archive className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Download ZIP</span>
          </button>
          <a
            href="https://app.nuon.co"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Deploy with Nuon
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* File tree - left */}
        <div className="w-48 lg:w-56 shrink-0 border-r border-border bg-card overflow-y-auto py-2 px-1.5">
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedFile.filename}
              onSelect={(file) => {
                setSelectedFile(file);
                if (!showCode) setShowCode(true);
              }}
            />
          ))}
        </div>

        {/* Code viewer - center (togglable) */}
        {showCode && (
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 shrink-0">
              <span className="text-sm font-mono text-muted-foreground truncate min-w-0 flex-1">
                {selectedFile.filename}
              </span>
              <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded uppercase shrink-0", badgeColor)}>
                {selectedFile.language}
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
              </button>
              <button
                onClick={handleDownloadFile}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-[#24292e] dark:bg-[#0d1117]">
              <div
                className="[&_pre]:!bg-transparent [&_pre]:px-5 [&_pre]:py-4 [&_pre]:m-0 [&_code]:text-[13px] [&_code]:!leading-snug [&_.line]:block [&_.line:empty]:h-[18px]"
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            </div>
          </div>
        )}

        {/* Next steps guide - right (expands when code hidden) */}
        <div className={cn(
          "shrink-0 border-l border-border bg-card flex flex-col",
          showCode ? "w-80 lg:w-96" : "flex-1"
        )}>
          <div className="flex items-center px-4 h-10 border-b border-border bg-muted/20 shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Next Steps
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className={cn(
              "py-6",
              showCode ? "px-4" : "px-6 max-w-xl mx-auto"
            )}>
              <ol className="list-none">
                <NextStep number={1} icon={Archive} title="Download and extract">
                  <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                    Hit <strong className="text-foreground">Download ZIP</strong> above, then extract into a new repo:
                  </p>
                  <CodeSnippet text={`mkdir ${appDirName} && cd ${appDirName}\nunzip ~\/Downloads\/${chart.name}-nuon-config.zip`} />
                </NextStep>

                <NextStep number={2} icon={Pencil} title="Review and customize">
                  <ul className="text-sm text-muted-foreground leading-relaxed space-y-2">
                    <li className="flex gap-2">
                      <span className="text-primary/60 shrink-0 mt-0.5">&#x2022;</span>
                      <span>Open <code className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">inputs.toml</code> — add, remove, or rename customer-facing inputs</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary/60 shrink-0 mt-0.5">&#x2022;</span>
                      <span>Check the values file for <code className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">TODO</code> comments and fill in placeholders</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-primary/60 shrink-0 mt-0.5">&#x2022;</span>
                      <span>Wire static values to inputs with <code className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">{"{{.nuon.install.inputs.<name>}}"}</code></span>
                    </li>
                  </ul>
                </NextStep>

                <NextStep number={3} icon={FolderTree} title="Push to GitHub">
                  <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                    Initialize a repo and push — the directory name must match your Nuon app name:
                  </p>
                  <CodeSnippet text={`git init && git add .\ngit commit -m "initial nuon config for ${chart.name}"\ngit remote add origin git@github.com:your-org/${appDirName}.git\ngit push -u origin main`} />
                </NextStep>

                <NextStep number={4} icon={Rocket} title="Create and sync your app">
                  <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                    Use the <a href="https://docs.nuon.co/cli" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Nuon CLI</a> to create the app and sync the config:
                  </p>
                  <CodeSnippet text={`nuon apps create -n ${appDirName}\nnuon apps sync`} />
                </NextStep>

                <NextStep number={5} icon={ShieldCheck} title="Validate and deploy" isLast>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                    Validate that everything is wired correctly, then create an install:
                  </p>
                  <CodeSnippet text={`nuon apps validate\nnuon installs create -a ${appDirName} -n my-first-install`} />
                </NextStep>
              </ol>

              <div className="mt-6 pt-5 border-t border-border flex flex-wrap gap-4">
                <a
                  href="https://docs.nuon.co/configuration-files"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  Configuration file reference
                </a>
                <a
                  href="https://docs.nuon.co/quickstart"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Rocket className="w-3.5 h-3.5 shrink-0" />
                  Quickstart guide
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
