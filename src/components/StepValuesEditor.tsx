import { useEffect, useState, useRef, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { getFileContent } from "@/lib/github";
import { NUON_VARIABLES, RECOMMENDED_PRESETS } from "@/lib/nuon";
import type { GitHubRepo, HelmChart, WizardAction } from "@/lib/types";
import { useTheme } from "@/hooks/use-theme";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  Database,
  Globe,
  MapPin,
  Cpu,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

const PRESET_ICONS: Record<string, React.ElementType> = {
  database: Database,
  domain: Globe,
  region: MapPin,
  resources: Cpu,
};

interface StepValuesEditorProps {
  repo: GitHubRepo;
  chart: HelmChart;
  valuesYaml: string;
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
  onBack: () => void;
}

export function StepValuesEditor({
  repo,
  chart,
  valuesYaml,
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
  const [enabledPresets, setEnabledPresets] = useState<Set<string>>(new Set());
  const [mobileSection, setMobileSection] = useState<"variables" | "recommendations" | null>(null);
  const [editorCanScroll, setEditorCanScroll] = useState(false);
  const editorRef = useRef<any>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    editor.trigger("keyboard", "type", { text });
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

  const togglePreset = useCallback(
    (presetId: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const preset = RECOMMENDED_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;

      const current = editor.getValue();
      const marker = `# --- ${preset.label} ---`;
      const block = `\n${marker}\n${preset.yaml}\n`;

      setEnabledPresets((prev) => {
        const next = new Set(prev);
        if (next.has(presetId)) {
          next.delete(presetId);
          const escaped = block.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const cleaned = current.replace(new RegExp(escaped), "");
          editor.setValue(cleaned);
          dispatch({ type: "SET_EDITED_VALUES", yaml: cleaned });
        } else {
          next.add(presetId);
          const appended = current + block;
          editor.setValue(appended);
          dispatch({ type: "SET_EDITED_VALUES", yaml: appended });
        }
        return next;
      });
    },
    [dispatch]
  );

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

  const recommendationsContent = (
    <div className="p-4 space-y-2">
      {RECOMMENDED_PRESETS.map((preset) => {
        const Icon = PRESET_ICONS[preset.id];
        const active = enabledPresets.has(preset.id);
        return (
          <button
            key={preset.id}
            onClick={() => togglePreset(preset.id)}
            className={cn(
              "w-full text-left px-3 py-3 rounded-lg border transition-all",
              active
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/30 hover:bg-muted/40"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                  active
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/40"
                )}
              >
                {active && (
                  <Check className="w-2.5 h-2.5 text-primary-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {Icon && (
                    <Icon
                      className={cn(
                        "w-3.5 h-3.5 shrink-0",
                        active ? "text-primary" : "text-muted-foreground"
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "text-sm font-medium",
                      active ? "text-primary" : "text-foreground"
                    )}
                  >
                    {preset.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {preset.description}
                </p>
                {active && (
                  <pre className="mt-2 text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2 overflow-x-auto leading-relaxed">
                    {preset.yaml}
                  </pre>
                )}
              </div>
            </div>
          </button>
        );
      })}

      <div className="pt-3 border-t border-border mt-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Toggle a recommendation to append its YAML block to the editor.
          Uncheck to remove.
        </p>
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
        <button
          onClick={onNext}
          className="flex items-center gap-1.5 px-4 sm:px-5 h-9 rounded-lg bg-primary text-primary-foreground text-base font-medium hover:bg-primary/90 transition-colors shrink-0 ml-4"
        >
          Generate config
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Desktop: 3-panel resizable layout */}
      <div className="hidden md:flex flex-1 min-h-0 bg-card">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="flex flex-col h-full">
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
                    renderLineHighlight: "none",
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

          <ResizableHandle />

          <ResizablePanel defaultSize={25} minSize={18}>
            <div className="flex flex-col h-full border-l border-border">
              <div className="flex items-center px-4 h-10 border-b border-border bg-muted/20 shrink-0">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Variables
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {variablesContent}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          <ResizablePanel defaultSize={25} minSize={18}>
            <div className="flex flex-col h-full border-l border-border">
              <div className="flex items-center px-4 h-10 border-b border-border bg-muted/20 shrink-0">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Recommendations
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {recommendationsContent}
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

        {/* Collapsible: Recommendations */}
        <div className="border-t border-border bg-card">
          <button
            onClick={() => setMobileSection(mobileSection === "recommendations" ? null : "recommendations")}
            className="w-full flex items-center justify-between px-4 h-10 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/20"
          >
            Recommendations
            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", mobileSection === "recommendations" && "rotate-180")} />
          </button>
          {mobileSection === "recommendations" && (
            <div className="max-h-[250px] overflow-y-auto border-t border-border">
              {recommendationsContent}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
