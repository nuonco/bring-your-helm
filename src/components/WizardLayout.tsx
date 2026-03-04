import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";
import { Sun, Moon, Share2, BookOpen, Link, Check, LogOut } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

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
  const { isAuthenticated, isConfigured, user, signIn, signOut } = useAuth();
  const progress = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
  const isLanding = currentStep === 0;
  const isFullscreen = currentStep === 2 || currentStep === 3;
  const contentWidth = isLanding
    ? "max-w-5xl"
    : isFullscreen
      ? ""
      : "max-w-3xl";
  const [copied, setCopied] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
    setShowShareMenu(false);
  }, []);

  const handleShareTwitter = useCallback(() => {
    const text = encodeURIComponent("Check out bring-your-helm — generate BYOC deployment configs from any Helm chart");
    const url = encodeURIComponent(window.location.href);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank", "width=550,height=420");
    setShowShareMenu(false);
  }, []);

  const handleShareLinkedIn = useCallback(() => {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, "_blank", "width=550,height=420");
    setShowShareMenu(false);
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
              bring-your-helm
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
            {isLanding && (
              <span className="hidden sm:inline text-sm text-muted-foreground ml-2">
                — Turn a Helm chart into a deploy-anywhere config
              </span>
            )}
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
            <div className="relative" ref={shareMenuRef}>
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                className="h-8 w-8 sm:w-auto sm:px-3 rounded-lg border border-border bg-card flex items-center justify-center sm:justify-start gap-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Share2 className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{copied ? "Copied!" : "Share"}</span>
              </button>
              {showShareMenu && (
                <div className="absolute right-0 top-full mt-1.5 w-48 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
                  <button
                    onClick={handleCopyLink}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 shrink-0 text-green-500" /> : <Link className="w-3.5 h-3.5 shrink-0" />}
                    {copied ? "Copied!" : "Copy link"}
                  </button>
                  <button
                    onClick={handleShareTwitter}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    Share on X
                  </button>
                  <button
                    onClick={handleShareLinkedIn}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    Share on LinkedIn
                  </button>
                </div>
              )}
            </div>
            {isConfigured && !isAuthenticated && (
              <button
                onClick={signIn}
                title="Sign in to access private repositories"
                className="h-8 px-3 rounded-lg border border-border bg-card flex items-center gap-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <GitHubIcon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Sign in</span>
              </button>
            )}
            {isAuthenticated && user && (
              <div className="flex items-center gap-1.5">
                <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                <button
                  onClick={signOut}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
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
            ? "pt-12 sm:pt-20 pb-16 sm:pb-24"
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
