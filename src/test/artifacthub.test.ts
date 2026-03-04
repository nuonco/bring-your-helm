import { describe, it, expect } from "vitest";
import { rankMatch, pickBestMatch } from "../lib/artifacthub";
import type { ArtifactHubMatch } from "../lib/types";

const makeMatch = (overrides: Partial<ArtifactHubMatch> = {}): ArtifactHubMatch => ({
  name: "nginx",
  version: "18.1.0",
  repoUrl: "https://charts.bitnami.com/bitnami",
  repoName: "bitnami",
  description: "NGINX Open Source is a web server",
  stars: 50,
  ...overrides,
});

describe("rankMatch", () => {
  it("gives +10 for exact name match", () => {
    const score = rankMatch(makeMatch({ name: "argo-events" }), "argo-events");
    expect(score).toBeGreaterThanOrEqual(10);
  });

  it("gives +5 for org match", () => {
    const score = rankMatch(makeMatch({ name: "other", repoName: "argoproj" }), "other", "argoproj");
    expect(score).toBeGreaterThanOrEqual(5);
  });

  it("gives +1 for popular charts", () => {
    const score = rankMatch(makeMatch({ name: "other", stars: 100 }), "something-else");
    expect(score).toBe(1);
  });

  it("gives 0 for no matches", () => {
    const score = rankMatch(makeMatch({ name: "other", stars: 0 }), "something-else");
    expect(score).toBe(0);
  });

  it("is case-insensitive for name", () => {
    const score = rankMatch(makeMatch({ name: "Argo-Events" }), "argo-events");
    expect(score).toBeGreaterThanOrEqual(10);
  });
});

describe("pickBestMatch", () => {
  it("returns exact name match with score >= 10", () => {
    const matches = [
      makeMatch({ name: "nginx-ingress", stars: 100 }),
      makeMatch({ name: "nginx", stars: 50 }),
      makeMatch({ name: "nginx-proxy", stars: 20 }),
    ];
    const best = pickBestMatch(matches, "nginx");
    expect(best).not.toBeNull();
    expect(best!.name).toBe("nginx");
  });

  it("returns null when no exact match exists", () => {
    const matches = [
      makeMatch({ name: "nginx-ingress", stars: 100 }),
      makeMatch({ name: "nginx-proxy", stars: 20 }),
    ];
    const best = pickBestMatch(matches, "nginx");
    expect(best).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(pickBestMatch([], "nginx")).toBeNull();
  });

  it("prefers match with org bonus", () => {
    const matches = [
      makeMatch({ name: "argo-events", repoName: "community", stars: 100 }),
      makeMatch({ name: "argo-events", repoName: "argoproj", stars: 50 }),
    ];
    const best = pickBestMatch(matches, "argo-events", "argoproj");
    expect(best).not.toBeNull();
    expect(best!.repoName).toBe("argoproj");
  });
});
