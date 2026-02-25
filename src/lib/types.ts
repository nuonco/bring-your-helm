export interface GitHubRepo {
  id: number;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  owner: {
    login: string;
    avatar_url: string;
  };
}

export interface ChartDependency {
  name: string;
  version: string;
  repository: string;
  condition: string;
}

export interface HelmChart {
  name: string;
  version: string;
  description: string;
  path: string;
  dependencies?: ChartDependency[];
}

export interface GeneratedFile {
  filename: string;
  language: string;
  content: string;
}

export interface ConfigOptions {
  cloudProvider: "aws" | "azure";
  infraMode: "default" | "bring-vpc";
  namespace: string;
  configRepo: string;
  infraDeps: string[];
}

export interface WizardState {
  step: number;
  repo: GitHubRepo | null;
  repoSubpath?: string;
  charts: HelmChart[];
  selectedChart: HelmChart | null;
  valuesYaml: string;
  editedValuesYaml: string;
  configOptions: ConfigOptions;
}

export type WizardAction =
  | { type: "SET_STEP"; step: number }
  | { type: "SET_REPO"; repo: GitHubRepo; subpath?: string }
  | { type: "SET_CHARTS"; charts: HelmChart[] }
  | { type: "SELECT_CHART"; chart: HelmChart }
  | { type: "SET_VALUES"; yaml: string }
  | { type: "SET_EDITED_VALUES"; yaml: string }
  | { type: "SET_CONFIG_OPTIONS"; options: Partial<ConfigOptions> }
  | { type: "RESET" };
