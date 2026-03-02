import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { generateNuonConfig, validateGeneratedConfig, NUON_VARIABLES } from "@/lib/nuon";
import type { ValidationWarning } from "@/lib/nuon";
import type { GitHubRepo, HelmChart, GeneratedFile, ConfigOptions, ChartFile } from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";
import { ArrowLeft, Copy, Check, Download, ExternalLink, FileText, Archive, Folder, FolderOpen, ChevronRight, ChevronDown, Terminal, FolderTree, Pencil, Rocket, ShieldCheck, BookOpen, Code2, Eye, EyeOff, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import JSZip from "jszip";

const LANG_BADGE_COLORS: Record<string, string> = {
  toml: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  yaml: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  hcl: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  json: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const MONACO_LANG_MAP: Record<string, string> = {
  toml: "ini",
  yaml: "yaml",
  hcl: "plaintext",
  json: "json",
};

interface StepGenerateProps {
  repo: GitHubRepo;
  chart: HelmChart;
  valuesYaml: string;
  configOptions: ConfigOptions;
  chartFiles: ChartFile[];
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

export function StepGenerate({ repo, chart, valuesYaml, configOptions, chartFiles, onBack, onReset, onGenerated }: StepGenerateProps) {
  const { theme } = useTheme();
  const files = useMemo(
    () => generateNuonConfig(repo.full_name, chart, valuesYaml, configOptions, chartFiles),
    [repo, chart, valuesYaml, configOptions, chartFiles]
  );

  const validationWarnings = useMemo(
    () => validateGeneratedConfig(files, configOptions),
    [files, configOptions]
  );
  const errors = validationWarnings.filter((w) => w.severity === "error");
  const warnings = validationWarnings.filter((w) => w.severity === "warning");

  const tree = useMemo(() => buildTree(files), [files]);

  const valuesFile = files.find((f) => f.filename.endsWith("values.yaml"));
  const [selectedFile, setSelectedFile] = useState<GeneratedFile>(valuesFile || files[0]);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(true);
  const [showGettingStarted, setShowGettingStarted] = useState(false);
  const appDirName = (configOptions.namespace || chart.name).toLowerCase().replace(/[^a-z0-9-]/g, "-");

  // Track user edits per file so changes persist across file switches and into ZIP download
  const editsRef = useRef<Record<string, string>>({});
  const editorRef = useRef<any>(null);
  const decorationsRef = useRef<any[]>([]);
  const hasScrolledToFirstMatchRef = useRef(false);

  const getFileContent = useCallback((file: GeneratedFile) => {
    return editsRef.current[file.filename] ?? file.content;
  }, []);

  // Highlight {{ .nuon.* }} template variables with decorations
  const updateDecorations = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches("\\{\\{\\s*\\.nuon\\.[^}]+\\}\\}", false, true, false, null, false);
    const newDecorations = matches.map((match: any) => ({
      range: match.range,
      options: {
        inlineClassName: "nuon-template-var",
        overviewRuler: {
          color: "rgba(99, 102, 241, 0.6)",
          position: 1, // OverviewRulerLane.Center
        },
      },
    }));
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, []);

  // Re-apply decorations when switching files
  useEffect(() => {
    const timer = setTimeout(updateDecorations, 50);
    return () => clearTimeout(timer);
  }, [selectedFile, updateDecorations]);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    updateDecorations();

    // Auto-scroll to first template variable on initial load
    if (!hasScrolledToFirstMatchRef.current) {
      const model = editor.getModel();
      if (model) {
        const matches = model.findMatches(
          "\\{\\{\\s*\\.nuon\\.[^}]+\\}\\}", false, true, false, null, false
        );
        if (matches.length > 0) {
          editor.revealLineInCenter(matches[0].range.startLineNumber);
          hasScrolledToFirstMatchRef.current = true;
        }
      }
    }
  };

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
      zip.file(`${appDirName}/${file.filename}`, editsRef.current[file.filename] ?? file.content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${appDirName}-nuon-config.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [files, appDirName]);

  const handleCopy = () => {
    navigator.clipboard.writeText(getFileContent(selectedFile));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([getFileContent(selectedFile)], { type: "text/plain" });
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
              {files.length} files generated — everything Nuon needs to deploy {chart.name} into any customer's cloud
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

      <style>{`.nuon-template-var { background: rgba(99, 102, 241, 0.15); border-radius: 3px; padding: 0 1px; }`}</style>

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

        {/* Code editor - center (togglable) */}
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
            <div className="flex-1 min-h-0">
              <Editor
                path={selectedFile.filename}
                language={MONACO_LANG_MAP[selectedFile.language] || "plaintext"}
                defaultValue={getFileContent(selectedFile)}
                theme={theme === "dark" ? "vs-dark" : "vs"}
                onMount={handleEditorMount}
                onChange={(value) => {
                  if (value !== undefined) {
                    editsRef.current[selectedFile.filename] = value;
                    updateDecorations();
                  }
                }}
                options={{
                  fontSize: 13,
                  fontFamily: "'Hack', monospace",
                  lineNumbers: "on",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 12 },
                  wordWrap: "on",
                  renderLineHighlight: "none",
                  overviewRulerLanes: 1,
                  hideCursorInOverviewRuler: true,
                  scrollbar: {
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6,
                  },
                }}
              />
            </div>
          </div>
        )}

        {/* Right panel — variable legend + collapsible getting started */}
        <div className={cn(
          "shrink-0 border-l border-border bg-card flex flex-col",
          showCode ? "w-72 lg:w-80" : "flex-1"
        )}>
          <div className="flex items-center px-4 h-10 border-b border-border bg-muted/20 shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Template Variables
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className={cn(
              "py-5",
              showCode ? "px-4" : "px-6 max-w-xl mx-auto"
            )}>
              {/* Legend explanation */}
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Values highlighted in{" "}
                <span className="nuon-template-var font-mono text-xs">indigo</span>{" "}
                are <strong className="text-foreground">Nuon template variables</strong>. At deploy time, Nuon replaces them with real values from each customer's install.
              </p>

              {/* Example card */}
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 mb-4">
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">Example</div>
                <code className="text-xs font-mono block leading-relaxed">
                  <span className="text-muted-foreground">hostname: </span>
                  <span className="nuon-template-var">{"{{ .nuon.inputs.inputs.subdomain }}"}</span>
                </code>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  Replaced with the customer's subdomain input at deploy time.
                </p>
              </div>

              {/* Common variables */}
              <div className="space-y-3 mb-4">
                <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Common variables
                </h4>
                {["Inputs", "Install", "Components"].map((category) => {
                  const vars = NUON_VARIABLES.filter((v) => v.category === category).slice(0, 3);
                  if (vars.length === 0) return null;
                  return (
                    <div key={category}>
                      <div className="text-xs font-medium text-foreground mb-1">{category}</div>
                      <ul className="space-y-1">
                        {vars.map((v) => (
                          <li key={v.template} className="text-xs leading-relaxed">
                            <code className="font-mono text-primary/80 break-all">{v.template}</code>
                            <span className="text-muted-foreground ml-1">— {v.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              {/* Docs link */}
              <div className="pb-4 border-b border-border">
                <a
                  href="https://docs.nuon.co/configuration-files"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  Full variable reference
                </a>
              </div>

              {/* Validation warnings */}
              {errors.length > 0 && (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <XCircle className="w-4 h-4 text-destructive shrink-0" />
                    <span className="text-sm font-medium text-destructive">Action needed</span>
                  </div>
                  <ul className="space-y-1">
                    {errors.map((e, i) => (
                      <li key={i} className="text-sm text-destructive/80 pl-6">{e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
                    <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">Heads up</span>
                  </div>
                  <ul className="space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i} className="text-sm text-yellow-600/80 dark:text-yellow-400/80 pl-6">
                        {w.message}{w.file && <span className="font-mono text-xs ml-1">({w.file})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Getting Started — collapsible */}
              <div className="mt-4 rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setShowGettingStarted(!showGettingStarted)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <Rocket className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm font-medium text-foreground flex-1">Getting Started</span>
                  <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", showGettingStarted && "rotate-180")} />
                </button>
                <div className={cn(
                  "grid transition-all duration-200 ease-out",
                  showGettingStarted ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}>
                  <div className="overflow-hidden">
                    <div className="px-3 pb-4 pt-1 border-t border-border">
                      <ol className="list-none">
                        <NextStep number={1} icon={Archive} title="Download and extract">
                          <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                            Hit <strong className="text-foreground">Download ZIP</strong> above, then extract into a new repo:
                          </p>
                          <CodeSnippet text={`unzip ~\/Downloads\/${appDirName}-nuon-config.zip\ncd ${appDirName}`} />
                        </NextStep>

                        <NextStep number={2} icon={Pencil} title="Review and customize">
                          <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                            The generated files are a starting point. Customize for your app:
                          </p>
                          <ul className="text-sm text-muted-foreground leading-relaxed space-y-2">
                            <li className="flex gap-2">
                              <span className="text-primary/60 shrink-0 mt-0.5">&#x2022;</span>
                              <span>Open <code className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">inputs.toml</code> — add, remove, or rename customer-facing inputs</span>
                            </li>
                            <li className="flex gap-2">
                              <span className="text-primary/60 shrink-0 mt-0.5">&#x2022;</span>
                              <span>Check the values file for <code className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">TODO</code> comments and fill in placeholders</span>
                            </li>
                          </ul>
                        </NextStep>

                        <NextStep number={3} icon={FolderTree} title="Push to GitHub">
                          <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                            Nuon reads your config from a GitHub repo:
                          </p>
                          <CodeSnippet text={`git init && git add .\ngit commit -m "initial nuon config for ${chart.name}"\ngit remote add origin git@github.com:your-org/${appDirName}.git\ngit push -u origin main`} />
                        </NextStep>

                        <NextStep number={4} icon={Rocket} title="Connect to Nuon">
                          <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                            Install the <a href="https://docs.nuon.co/cli" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Nuon CLI</a>, then create your app:
                          </p>
                          <CodeSnippet text={`nuon apps create -n ${appDirName}\nnuon apps sync`} />
                        </NextStep>

                        <NextStep number={5} icon={ShieldCheck} title="Validate and deploy" isLast>
                          <p className="text-sm text-muted-foreground leading-relaxed mb-2.5">
                            Validate your config, then create your first install:
                          </p>
                          <CodeSnippet text={`nuon apps validate\nnuon installs create -a ${appDirName} -n my-first-install`} />
                        </NextStep>
                      </ol>

                      <div className="mt-4 pt-3 border-t border-border">
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
          </div>
        </div>
      </div>
    </div>
  );
}
