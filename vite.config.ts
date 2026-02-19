import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: {
        "/api/github": {
          target: "https://api.github.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/github/, ""),
          headers: {
            Accept: "application/vnd.github+json",
            ...(env.GITHUB_TOKEN
              ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` }
              : {}),
          },
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
