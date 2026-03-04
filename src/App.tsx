import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/hooks/use-theme";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { setAuthToken } from "@/lib/github";
import Index from "./pages/Index";

const queryClient = new QueryClient();

/** Syncs auth token from React context → github module */
function AuthTokenSync({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  useEffect(() => { setAuthToken(token); }, [token]);
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <AuthTokenSync>
          <TooltipProvider>
            <Toaster />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/select-chart" element={<Index />} />
                <Route path="/configure" element={<Index />} />
                <Route path="/generate" element={<Index />} />
                <Route path="*" element={<Index />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </AuthTokenSync>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
