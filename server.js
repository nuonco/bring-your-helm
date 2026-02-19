import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use("/api/github", async (req, res) => {
  const url = `https://api.github.com${req.url}`;
  const headers = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  try {
    const upstream = await fetch(url, { headers });

    res.status(upstream.status);
    for (const h of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    res.set("content-type", upstream.headers.get("content-type") || "application/json");

    const body = await upstream.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (err) {
    console.error("GitHub proxy error:", err.message);
    res.status(502).json({ message: "Failed to reach GitHub API" });
  }
});

app.use(express.static(path.join(__dirname, "dist")));
app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  if (GITHUB_TOKEN) {
    console.log("GitHub API requests will be authenticated");
  } else {
    console.log("No GITHUB_TOKEN set — requests will be unauthenticated (60 req/hr)");
  }
});
