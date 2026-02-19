import { useEffect, useState, useRef, useMemo } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { getFileContent } from "@/lib/github";
import { NUON_VARIABLES, detectInfraDeps } from "@/lib/nuon";
import type { GitHubRepo, HelmChart, WizardAction, ConfigOptions } from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  Code2,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

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
  const [inputName, setInputName] = useState("");
  const [hasSelection, setHasSelection] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [mobileSection, setMobileSection] = useState<"variables" | "configure" | null>(null);
  const [showEditor, setShowEditor] = useState(true);
  const [editorCanScroll, setEditorCanScroll] = useState(false);
  const editorRef = useRef<any>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const autoDetectedDeps = useMemo(
    () => detectInfraDeps(chart.dependencies || []),
    [chart.dependencies]
  );

  useEffect(() => {
    if (autoDetectedDeps.length > 0 && configOptions.infraDeps.length === 0) {
      dispatch({ type: "SET_CONFIG_OPTIONS", options: { infraDeps: autoDetectedDeps } });
    }
  }, [autoDetectedDeps, configOptions.infraDeps.length, dispatch]);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    const checkScroll = () => {
      const scrollTop = editor.getScrollTop();
      const scrollHeight = editor.getScrollHeight();
      const clientHeight = editor.getLayoutInfo().height;
      setEditorCanScroll(scrollHeight - scrollTop - clientHeight > 20);
    };
    editor.onDidScrollChange(checkScroll);
    editor.onDidChangeModelContent(checkScroll);
    setTimeout(checkScroll, 500);
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection && !selection.isEmpty() && model) {
        setHasSelection(true);
        setSelectedText(model.getValueInRange(selection));
        const endPos = selection.getEndPosition();
        const coords = editor.getScrolledVisiblePosition(endPos);
        if (coords && editorContainerRef.current) {
          setPopoverPos({ top: coords.top + coords.height + 4, left: coords.left });
        }
      } else {
        setHasSelection(false);
        setSelectedText("");
        setPopoverPos(null);
      }
    });
  };

  const confirmMakeInput = () => {
    const editor = editorRef.current;
    if (!editor || !inputName.trim()) return;
    const selection = editor.getSelection();
    if (!selection) return;
    const template = `{{.nuon.install.inputs.${inputName.trim()}}}`;
    editor.executeEdits("make-input", [{ range: selection, text: template }]);
    dispatch({ type: "SET_EDITED_VALUES", yaml: editor.getValue() });
    setInputName("");
    editor.focus();
  };

  const insertAtCursor = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    if (selection) {
      editor.executeEdits("insert-variable", [
        { range: selection, text, forceMoveMarkers: true },
      ]);
    }
    dispatch({ type: "SET_EDITED_VALUES", yaml: editor.getValue() });
    editor.focus();
    setCopiedVar(text);
    setTimeout(() => setCopiedVar(null), 1200);
  };

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

  useEffect(() => {
    if (hasSelection && inputRef.current) {
      inputRef.current.focus();
    }
  }, [hasSelection]);

  const categories = [...new Set(NUON_VARIABLES.map((v) => v.category))];

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
                  <div className="flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); insertAtCursor(v.template); }}
                      className="text-xs text-muted-foreground hover:text-primary transition-colors px-1"
                      title="Insert at cursor"
                    >
                      Insert
                    </button>
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
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Cloud Provider
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
        </div>
      </div>

      {/* Infrastructure Mode */}
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Infrastructure Mode
        </div>
        <div className="space-y-0.5">
          {([["default", "Default"], ["bring-vpc", "Bring own VPC"], ["bring-cluster", "Bring own cluster"]] as const).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2.5 px-1 py-1.5 rounded cursor-pointer hover:bg-muted/40 transition-colors">
              <input
                type="radio"
                name="infraMode"
                checked={configOptions.infraMode === value}
                onChange={() => dispatch({ type: "SET_CONFIG_OPTIONS", options: { infraMode: value } })}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Infrastructure Dependencies */}
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
          Infrastructure Dependencies
        </div>
        {autoDetectedDeps.length > 0 && (
          <p className="text-xs text-primary mb-2">
            {autoDetectedDeps.length} detected from Chart.yaml
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
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Namespace
        </div>
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
          The GitHub repo where you'll push this config.
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
  );

  const mobileEditorPanel = (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <Editor
          defaultLanguage="yaml"
          value={valuesYaml}
          onChange={(value) =>
            dispatch({ type: "SET_EDITED_VALUES", yaml: value || "" })
          }
          theme={theme === "dark" ? "vs-dark" : "vs"}
          onMount={handleEditorMount}
          options={{
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
              {chart.name}/values.yaml
            </span>
            <span className="text-sm text-muted-foreground hidden sm:block">
              Customize values for your deployment, then generate your config
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <button
            onClick={() => setShowEditor(!showEditor)}
            className={cn(
              "hidden md:flex items-center gap-1.5 px-3 h-9 rounded-lg border text-sm font-medium transition-colors",
              showEditor
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:bg-muted"
            )}
          >
            {showEditor ? <EyeOff className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{showEditor ? "Hide editor" : "Show editor"}</span>
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

      {/* Desktop: resizable layout — Configure | Editor | Variables */}
      <div className="hidden md:flex flex-1 min-h-0 bg-card">
        <ResizablePanelGroup direction="horizontal" key={showEditor ? "with-editor" : "no-editor"}>
          <ResizablePanel defaultSize={showEditor ? 22 : 50} minSize={16}>
            <div className="flex flex-col h-full">
              <div className="flex items-center px-4 h-10 border-b border-border bg-muted/20 shrink-0">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Configure
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="px-4 pt-3 pb-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Set your deployment target and infrastructure options. These settings control which Nuon config files are generated.
                  </p>
                </div>
                {configureContent}
              </div>
            </div>
          </ResizablePanel>

          {showEditor && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={56} minSize={30}>
                <div className="flex flex-col h-full border-l border-border">
                  <div className="flex-1 min-h-0 relative" ref={editorContainerRef}>
                    <Editor
                      defaultLanguage="yaml"
                      value={valuesYaml}
                      onChange={(value) =>
                        dispatch({ type: "SET_EDITED_VALUES", yaml: value || "" })
                      }
                      theme={theme === "dark" ? "vs-dark" : "vs"}
                      onMount={handleEditorMount}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        fontFamily: "'Hack', monospace",
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        padding: { top: 12 },
                        wordWrap: "on",
                        renderLineHighlight: "line",
                        overviewRulerLanes: 0,
                        hideCursorInOverviewRuler: true,
                        scrollbar: {
                          verticalScrollbarSize: 6,
                          horizontalScrollbarSize: 6,
                        },
                      }}
                    />
                    {editorCanScroll && (
                      <div className="absolute bottom-0 left-0 right-3 h-10 bg-gradient-to-t from-[var(--vscode-editor-background,hsl(var(--card)))] to-transparent pointer-events-none z-10" />
                    )}
                    {hasSelection && popoverPos && (
                      <div
                        className="absolute z-50 bg-card border border-border rounded-lg shadow-lg p-2 flex items-center gap-2"
                        style={{ top: popoverPos.top, left: Math.max(8, popoverPos.left) }}
                      >
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">Make input:</span>
                        <input
                          ref={inputRef}
                          value={inputName}
                          onChange={(e) => setInputName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && confirmMakeInput()}
                          placeholder="input_name"
                          className="h-6 w-28 px-2 text-xs font-mono bg-background border border-border rounded-md outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all"
                        />
                        <button
                          onClick={confirmMakeInput}
                          disabled={!inputName.trim()}
                          className="px-2.5 h-6 text-[11px] font-medium rounded-md bg-primary text-primary-foreground disabled:opacity-30 hover:bg-primary/90 transition-colors shrink-0"
                        >
                          Replace
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </ResizablePanel>
            </>
          )}

          <ResizableHandle />

          <ResizablePanel defaultSize={showEditor ? 22 : 50} minSize={16}>
            <div className="flex flex-col h-full border-l border-border">
              <div className="flex items-center px-4 h-10 border-b border-border bg-muted/20 shrink-0">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Variables
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="px-4 pt-3 pb-2">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Click to copy a template variable, or use Insert to add it at the cursor position in the editor.
                  </p>
                </div>
                {variablesContent}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Mobile: stacked layout */}
      <div className="flex flex-col md:hidden flex-1 min-h-0">
        <div className="flex-1 min-h-[250px] bg-card">
          {mobileEditorPanel}
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
