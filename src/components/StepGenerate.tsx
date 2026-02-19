import { useMemo, useState, useEffect, useCallback } from "react";
import { codeToHtml } from "shiki";
import { generateNuonConfig } from "@/lib/nuon";
import type { GitHubRepo, HelmChart, GeneratedFile, ConfigOptions } from "@/lib/types";
import { ArrowLeft, Copy, Check, Download, ExternalLink, FileText, Archive, Folder, Terminal, FolderTree, Pencil, Rocket, ShieldCheck, BookOpen } from "lucide-react";
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
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (file: GeneratedFile) => void;
}) {
  const isFolder = !node.file;
  const isSelected = node.file && node.path === selectedPath;

  return (
    <>
      <button
        onClick={() => node.file && onSelect(node.file)}
        className={cn(
          "w-full flex items-center gap-2 py-1.5 text-left text-sm transition-colors rounded-md px-2",
          isFolder
            ? "text-muted-foreground font-medium cursor-default"
            : isSelected
              ? "bg-primary/10 text-primary font-medium"
              : "text-foreground hover:bg-muted/50 cursor-pointer"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        disabled={isFolder}
      >
        {isFolder ? (
          <Folder className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileText className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className="truncate font-mono text-xs">{node.name}</span>
      </button>
      {node.children.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + (isFolder ? 1 : 0)}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function NextStep({
  number,
  icon: Icon,
  title,
  children,
}: {
  number: number;
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
          {number}
        </div>
        <div className="flex-1 w-px bg-border mt-1.5" />
      </div>
      <div className="pb-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="w-3.5 h-3.5 text-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground">{title}</span>
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
  const appDirName = chart.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  useEffect(() => {
    const lang = SHIKI_LANG_MAP[selectedFile.language] || "text";
    codeToHtml(selectedFile.content, { lang, theme: "github-dark" }).then(setHighlighted);
  }, [selectedFile]);

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

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* File tree - left */}
        <div className="w-56 lg:w-64 shrink-0 border-r border-border bg-card overflow-y-auto py-2 px-1.5">
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedFile.filename}
              onSelect={setSelectedFile}
            />
          ))}
        </div>

        {/* Code viewer + guide - right */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* File toolbar */}
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

          {/* Code */}
          <div className="bg-[#24292e] dark:bg-[#0d1117]">
            <div
              className="text-sm [&_pre]:!bg-transparent [&_pre]:px-5 [&_pre]:py-4 [&_pre]:m-0 [&_code]:text-[14px] [&_code]:leading-[1.7] [&_.line]:block"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </div>

          {/* Next steps guide */}
          <div className="border-t border-border bg-card px-6 py-6">
            <h3 className="text-base font-medium text-foreground mb-5">What to do with these files</h3>
            <ol className="space-y-5">
              <NextStep
                number={1}
                icon={Terminal}
                title="Create a git repository for your app config"
              >
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                  Nuon app configurations live in a git repository. Create a new directory named after your app (the directory name must match your Nuon app name):
                </p>
                <CodeSnippet text={`mkdir ${appDirName} && cd ${appDirName}\ngit init`} />
              </NextStep>

              <NextStep
                number={2}
                icon={FolderTree}
                title="Save the generated files"
              >
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                  Use the "Download all as ZIP" button or copy individual files into your app directory. Maintain the directory structure shown in the filenames:
                </p>
                <pre className="text-xs font-mono text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 leading-relaxed overflow-x-auto">
{`${appDirName}/
  metadata.toml
  inputs.toml
  components/
    ${files.find(f => f.filename.match(/components\/\d+-.*\.toml$/))?.filename.split("/").pop() || "1-chart.toml"}
    values/
      ${chart.name}/
        values.yaml`}
                </pre>
              </NextStep>

              <NextStep
                number={3}
                icon={Pencil}
                title="Review and customize"
              >
                <p className="text-sm text-muted-foreground leading-relaxed mb-1.5">
                  The generated config is a scaffold that needs your review:
                </p>
                <ul className="text-sm text-muted-foreground leading-relaxed list-disc list-inside space-y-1">
                  <li>Check <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded">inputs.toml</code> — add or remove customer-facing inputs</li>
                  <li>Check the values file — look for <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded">TODO</code> comments and wire Nuon template variables to the right Helm values</li>
                  <li>The original values.yaml is included — customize it with <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded">{"{{ .nuon.inputs.inputs.<name> }}"}</code> variables</li>
                  <li>Add <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded">sandbox.toml</code>, <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded">runner.toml</code>, and <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded">permissions/</code> as needed (see docs)</li>
                </ul>
              </NextStep>

              <NextStep
                number={4}
                icon={Rocket}
                title="Create your app and sync"
              >
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                  Use the Nuon CLI to create your app in the control plane and sync the config:
                </p>
                <CodeSnippet text={`nuon apps create -n ${appDirName}\nnuon apps sync`} />
              </NextStep>

              <NextStep
                number={5}
                icon={ShieldCheck}
                title="Validate"
              >
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                  After syncing, validate your configuration to catch any issues before deployment:
                </p>
                <CodeSnippet text="nuon apps validate" />
              </NextStep>
            </ol>

            <div className="mt-5 pt-4 border-t border-border flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground">
                For the full configuration file reference, see the{" "}
                <a
                  href="https://docs.nuon.co/configuration-files"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Nuon configuration docs
                </a>.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
