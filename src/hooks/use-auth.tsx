import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

interface AuthContextValue {
  token: string | null;
  user: GitHubUser | null;
  isAuthenticated: boolean;
  isConfigured: boolean;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  isAuthenticated: false,
  isConfigured: false,
  loading: true,
  signIn: () => {},
  signOut: () => {},
});

const TOKEN_KEY = "byocify-gh-token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  // On mount: handle OAuth callback params, check config, validate token
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Handle auth_token from callback
    const callbackToken = params.get("auth_token");
    if (callbackToken) {
      localStorage.setItem(TOKEN_KEY, callbackToken);
      setToken(callbackToken);
      trackEvent("sign_in_completed");
      // Strip auth params from URL
      params.delete("auth_token");
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }

    // Handle auth_error from callback
    const authError = params.get("auth_error");
    if (authError) {
      toast.error(`GitHub sign-in failed: ${authError}`);
      params.delete("auth_error");
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }

    // Check if OAuth is configured
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((data) => setIsConfigured(data.configured))
      .catch(() => setIsConfigured(false));

    // Validate stored token
    const activeToken = callbackToken || localStorage.getItem(TOKEN_KEY);
    if (activeToken) {
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
        .then((r) => {
          if (!r.ok) throw new Error("Invalid token");
          return r.json();
        })
        .then((data) => setUser(data))
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const signIn = useCallback(() => {
    window.location.href = "/api/auth/github";
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: !!user,
        isConfigured,
        loading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
