import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const STEPS = ["Search", "Helm Chart", "Values", "Generate"];

interface WizardLayoutProps {
  currentStep: number;
  children: React.ReactNode;
  onReset: () => void;
}

export function WizardLayout({ currentStep, children, onReset }: WizardLayoutProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button onClick={onReset} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-xl font-bold tracking-tight text-foreground">
              byocify
            </span>
            <span className="text-xs font-medium text-primary bg-accent px-2 py-0.5 rounded-full">
              beta
            </span>
          </button>

          {/* Step indicator */}
          {currentStep > 0 && (
            <nav className="hidden sm:flex items-center gap-1">
              {STEPS.map((label, i) => {
                const isActive = i === currentStep;
                const isDone = i < currentStep;
                return (
                  <div key={label} className="flex items-center">
                    {i > 0 && (
                      <div
                        className={cn(
                          "w-8 h-px mx-1",
                          isDone ? "bg-primary" : "bg-border"
                        )}
                      />
                    )}
                    <div className="flex items-center gap-1.5">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
                          isDone && "bg-primary text-primary-foreground",
                          isActive && "bg-primary/20 text-primary border border-primary",
                          !isDone && !isActive && "bg-muted text-muted-foreground"
                        )}
                      >
                        {isDone ? <Check className="w-3 h-3" /> : i + 1}
                      </div>
                      <span
                        className={cn(
                          "text-sm",
                          isActive ? "text-foreground font-medium" : "text-muted-foreground"
                        )}
                      >
                        {label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </nav>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
