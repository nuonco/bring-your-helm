import { useState, useRef, useEffect } from "react";
import { Search, Star, Github, ArrowRight, Loader2 } from "lucide-react";
import { searchRepos, parseRepoUrl, getRepoByFullName } from "@/lib/github";
import type { GitHubRepo, WizardAction } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StepSearchProps {
  dispatch: React.Dispatch<WizardAction>;
  onNext: () => void;
}

export function StepSearch({ dispatch, onNext }: StepSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        // Check if it's a URL
        const parsed = await parseRepoUrl(value);
        if (parsed) {
          const repo = await getRepoByFullName(`${parsed.owner}/${parsed.repo}`);
          setResults([repo]);
        } else {
          const repos = await searchRepos(value);
          setResults(repos);
        }
        setShowResults(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  };

  const selectRepo = (repo: GitHubRepo) => {
    dispatch({ type: "SET_REPO", repo });
    setShowResults(false);
    onNext();
  };

  return (
    <div className="flex flex-col items-center text-center">
      {/* Logo & tagline */}
      <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground mb-3">
        byocify
      </h1>
      <p className="text-lg text-muted-foreground mb-10 max-w-md">
        Turn any Helm chart into a BYOC app in minutes
      </p>

      {/* Search box */}
      <div ref={containerRef} className="w-full max-w-2xl relative">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/50 to-primary/30 rounded-xl blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-300" />
          <div className="relative flex items-center bg-card border border-border rounded-xl shadow-lg">
            <Search className="ml-4 w-5 h-5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => results.length > 0 && setShowResults(true)}
              placeholder="Paste a GitHub repo URL or search for one..."
              className="flex-1 bg-transparent px-4 py-4 text-base text-foreground placeholder:text-muted-foreground outline-none"
            />
            {loading && <Loader2 className="mr-4 w-5 h-5 text-muted-foreground animate-spin" />}
          </div>
        </div>

        {/* Results dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50">
            {results.map((repo) => (
              <button
                key={repo.id}
                onClick={() => selectRepo(repo)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors text-left group"
              >
                <img
                  src={repo.owner.avatar_url}
                  alt=""
                  className="w-8 h-8 rounded-full shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {repo.full_name}
                  </div>
                  {repo.description && (
                    <div className="text-xs text-muted-foreground truncate">
                      {repo.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Star className="w-3 h-3" />
                  {repo.stargazers_count.toLocaleString()}
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Secondary option */}
      <button className="mt-8 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <Github className="w-4 h-4" />
        Connect your GitHub for private repos
      </button>
    </div>
  );
}
