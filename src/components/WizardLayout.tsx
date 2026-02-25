import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { Sun, Moon, Share2, BookOpen } from "lucide-react";
import { useState, useCallback } from "react";

function NuonLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="50 35 100 135"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M121.15 40.312 97.964 53.715v21.7L79.197 64.56h-.01L56.822 77.492v71.159l22.362 12.933h.01l24.01-13.885v-20.748l17.956 10.374 23.185-13.403V53.715l-23.185-13.403h-.011Zm-59.097 40.21 17.121-9.892h.011l18.769 10.844v36.388L62.053 97.115V80.522Zm35.9 64.147-18.779 10.845-17.121-9.892v-42.448l35.9 20.748v20.747Zm41.142-23.788-17.945 10.374-17.945-10.363V84.504l35.901 20.747v15.63h-.011Zm0-21.689-35.901-20.747v-21.7L121.15 46.37l17.945 10.374v42.447Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface WizardLayoutProps {
  currentStep: number;
  totalSteps: number;
  configCount: number;
  children: React.ReactNode;
  onReset: () => void;
}

export function WizardLayout({
  currentStep,
  totalSteps,
  configCount,
  children,
  onReset,
}: WizardLayoutProps) {
  const { theme, toggle } = useTheme();
  const progress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
  const isLanding = currentStep === 0;
  const isFullscreen = currentStep === 2 || currentStep === 3;
  const contentWidth = isLanding
    ? "max-w-5xl"
    : isFullscreen
      ? ""
      : "max-w-3xl";
  const [shared, setShared] = useState(false);

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }, []);

  return (
    <div className={cn("bg-background flex flex-col", isFullscreen ? "h-screen overflow-hidden" : "min-h-screen")}>
      {/* Hairline progress bar */}
      <div className="fixed top-0 left-0 right-0 h-px bg-border z-50">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <header className={cn("px-4 sm:px-6 shrink-0", isFullscreen ? "py-2.5 border-b border-border" : "py-4 sm:py-5")}>
        <div className="max-w-[1800px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onReset}
              className="text-base font-medium tracking-tight text-foreground hover:text-primary transition-colors"
            >
              byocify
            </button>
            <span className="text-muted-foreground/50">·</span>
            <a
              href="https://nuon.co"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <NuonLogo className="w-3.5 h-3.5" />
              <span className="text-sm">Powered by Nuon</span>
            </a>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <a
              href="https://docs.nuon.co/configuration-files"
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 w-8 sm:w-auto sm:px-3 rounded-lg border border-border bg-card flex items-center justify-center sm:justify-start gap-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Docs</span>
            </a>
            <button
              onClick={handleShare}
              className="h-8 w-8 sm:w-auto sm:px-3 rounded-lg border border-border bg-card flex items-center justify-center sm:justify-start gap-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">{shared ? "Copied!" : "Share"}</span>
            </button>
            <button
              onClick={toggle}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main
        className={cn(
          "flex-1",
          isFullscreen
            ? "flex flex-col min-h-0"
            : "px-4 sm:px-6",
          isLanding
            ? "pt-8 sm:pt-12 pb-12 sm:pb-20"
            : isFullscreen
              ? ""
              : "flex items-center justify-center pb-8 sm:pb-16"
        )}
      >
        <div className={cn(
          "w-full",
          isFullscreen
            ? "flex-1 flex flex-col min-h-0"
            : cn("mx-auto", contentWidth)
        )}>
          {children}
        </div>
      </main>

    
    </div>
  );
}
