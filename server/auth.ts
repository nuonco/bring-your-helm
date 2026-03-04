import { Router, type Request, type Response } from "express";
import crypto from "crypto";

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const BASE_URL = process.env.BASE_URL || "http://localhost:10000";

// Whether OAuth is configured
router.get("/config", (_req: Request, res: Response) => {
  res.json({ configured: !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) });
});

// Initiate GitHub OAuth
router.get("/github", (_req: Request, res: Response) => {
  if (!GITHUB_CLIENT_ID) {
    res.status(500).json({ error: "GitHub OAuth not configured" });
    return;
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000, // 10 minutes
    sameSite: "lax",
  });
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${BASE_URL}/api/auth/github/callback`,
    scope: "read:user repo",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GitHub OAuth callback
router.get("/github/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as Record<string, string>;
  const savedState = req.cookies?.oauth_state;

  if (!state || state !== savedState) {
    res.redirect(`/?auth_error=${encodeURIComponent("Invalid OAuth state")}`);
    return;
  }

  res.clearCookie("oauth_state");

  if (!code) {
    res.redirect(`/?auth_error=${encodeURIComponent("No authorization code received")}`);
    return;
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as Record<string, string>;
    if (tokenData.error) {
      res.redirect(`/?auth_error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
      return;
    }

    const token = tokenData.access_token;
    res.redirect(`/?auth_token=${token}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    res.redirect(`/?auth_error=${encodeURIComponent(message)}`);
  }
});

// Validate token and return user info
router.get("/me", async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token" });
    return;
  }

  try {
    const ghRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: auth,
        Accept: "application/vnd.github+json",
      },
    });
    if (!ghRes.ok) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    const user = (await ghRes.json()) as Record<string, unknown>;
    res.json({ login: user.login, avatar_url: user.avatar_url, name: user.name });
  } catch {
    res.status(500).json({ error: "Failed to validate token" });
  }
});

export default router;
