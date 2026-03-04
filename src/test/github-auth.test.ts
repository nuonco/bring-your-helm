import { describe, it, expect, vi, beforeEach } from "vitest";
import { setAuthToken } from "../lib/github";

describe("GitHub auth token", () => {
  beforeEach(() => {
    setAuthToken(null);
    vi.restoreAllMocks();
  });

  it("includes Authorization header when token is set", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ items: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    setAuthToken("ghp_testtoken123");

    const { searchRepos } = await import("../lib/github");
    await searchRepos("test-query");

    expect(mockFetch).toHaveBeenCalled();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).toHaveProperty("Authorization", "Bearer ghp_testtoken123");
  });

  it("omits Authorization header when no token is set", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ items: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    setAuthToken(null);

    const { searchRepos } = await import("../lib/github");
    await searchRepos("test-query");

    expect(mockFetch).toHaveBeenCalled();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });
});
