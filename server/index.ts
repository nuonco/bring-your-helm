import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import authRouter from "./auth.js";
import artifacthubRouter from "./artifacthub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || "10000", 10);

app.use(cookieParser());
app.use(express.json());

// API routes
app.use("/api/auth", authRouter);
app.use("/api/artifacthub", artifacthubRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Serve Vite static build
const distDir = path.resolve(__dirname, "..", "dist");
app.use(express.static(distDir));

// SPA fallback — all non-API GET requests serve index.html
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
