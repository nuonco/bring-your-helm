import { describe, it, expect } from "vitest";
import { generateNuonConfig, validateGeneratedConfig } from "../lib/nuon";
import type { HelmChart, ConfigOptions, ChartSource } from "../lib/types";

const baseChart: HelmChart = {
  name: "argo-events",
  version: "2.4.0",
  description: "Argo Events for Kubernetes",
  path: "charts/argo-events",
};

function makeOptions(chartSource: ChartSource): ConfigOptions {
  return {
    cloudProvider: "aws",
    infraMode: "default",
    namespace: "argo-events",
    configRepo: "myorg/myrepo",
    infraDeps: [],
    chartSource,
  };
}

describe("generateAppComponent via generateNuonConfig", () => {
  it("generates [helm_repo] block for helm_repo source", () => {
    const options = makeOptions({
      type: "helm_repo",
      match: {
        name: "argo-events",
        version: "2.4.0",
        repoUrl: "https://argoproj.github.io/argo-helm",
        repoName: "argo",
        description: "Argo Events",
        stars: 50,
      },
    });
    const files = generateNuonConfig("argoproj/argo-helm", baseChart, "", options);
    const helmFile = files.find((f) => f.content.includes('type = "helm_chart"'));
    expect(helmFile).toBeDefined();
    expect(helmFile!.content).toContain("[helm_repo]");
    expect(helmFile!.content).toContain('repo_url = "https://argoproj.github.io/argo-helm"');
    expect(helmFile!.content).toContain('chart    = "argo-events"');
    expect(helmFile!.content).toContain('version  = "2.4.0"');
    expect(helmFile!.content).not.toContain("[public_repo]");
  });

  it("generates [public_repo] for upstream_repo source", () => {
    const options = makeOptions({ type: "upstream_repo" });
    const files = generateNuonConfig("argoproj/argo-helm", baseChart, "", options);
    const helmFile = files.find((f) => f.content.includes('type = "helm_chart"'));
    expect(helmFile).toBeDefined();
    expect(helmFile!.content).toContain("[public_repo]");
    expect(helmFile!.content).toContain('repo = "argoproj/argo-helm"');
    expect(helmFile!.content).toContain('directory = "charts/argo-events"');
    expect(helmFile!.content).not.toContain("[helm_repo]");
  });

  it("generates [public_repo] pointing at config repo for bundle source", () => {
    const options = makeOptions({ type: "bundle" });
    const files = generateNuonConfig("argoproj/argo-helm", baseChart, "", options);
    const helmFile = files.find((f) => f.content.includes('type = "helm_chart"'));
    expect(helmFile).toBeDefined();
    expect(helmFile!.content).toContain("[public_repo]");
    expect(helmFile!.content).toContain('repo = "myorg/myrepo"');
    expect(helmFile!.content).toContain('directory = "components/chart/argo-events"');
    expect(helmFile!.content).not.toContain("[helm_repo]");
  });
});

describe("validateGeneratedConfig", () => {
  it("does not warn about monorepo for helm_repo source", () => {
    const options = makeOptions({
      type: "helm_repo",
      match: {
        name: "argo-events",
        version: "2.4.0",
        repoUrl: "https://argoproj.github.io/argo-helm",
        repoName: "argo",
        description: "",
        stars: 0,
      },
    });
    const files = generateNuonConfig("argoproj/argo-helm", baseChart, "", options);
    const warnings = validateGeneratedConfig(files, options);
    const monorepoWarning = warnings.find((w) => w.message.includes("monorepo"));
    expect(monorepoWarning).toBeUndefined();
  });
});
