import { Router, type Request, type Response } from "express";

const router = Router();

const AH_BASE = "https://artifacthub.io/api/v1";

router.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q as string;
  if (!q) {
    res.status(400).json({ error: "Missing query parameter 'q'" });
    return;
  }

  try {
    const ahRes = await fetch(
      `${AH_BASE}/packages/search?ts_query_web=${encodeURIComponent(q)}&kind=0&limit=10`
    );
    if (!ahRes.ok) {
      res.status(ahRes.status).json({ error: "ArtifactHub API error" });
      return;
    }
    const data = await ahRes.json();
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy error";
    res.status(502).json({ error: message });
  }
});

export default router;
