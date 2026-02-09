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

export interface HelmChart {
  name: string;
  version: string;
  description: string;
  path: string;
}

export interface WizardState {
  step: number;
  repo: GitHubRepo | null;
  charts: HelmChart[];
  selectedChart: HelmChart | null;
  valuesYaml: string;
  editedValuesYaml: string;
}

export type WizardAction =
  | { type: "SET_STEP"; step: number }
  | { type: "SET_REPO"; repo: GitHubRepo }
  | { type: "SET_CHARTS"; charts: HelmChart[] }
  | { type: "SELECT_CHART"; chart: HelmChart }
  | { type: "SET_VALUES"; yaml: string }
  | { type: "SET_EDITED_VALUES"; yaml: string }
  | { type: "RESET" };
