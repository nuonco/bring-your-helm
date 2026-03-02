import { useReducer, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { WizardState, WizardAction, ConfigOptions } from "@/lib/types";

const STEP_PATHS = ["/", "/select-chart", "/configure", "/generate"] as const;

function stepFromPath(pathname: string): number {
  const idx = STEP_PATHS.indexOf(pathname as (typeof STEP_PATHS)[number]);
  return idx >= 0 ? idx : 0;
}

const defaultConfigOptions: ConfigOptions = {
  cloudProvider: "aws",
  infraMode: "default",
  namespace: "",
  configRepo: "",
  infraDeps: [],
  bundleChart: false,
};

const initialState: WizardState = {
  step: 0,
  repo: null,
  charts: [],
  selectedChart: null,
  valuesYaml: "",
  editedValuesYaml: "",
  configOptions: defaultConfigOptions,
  chartFiles: [],
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };
    case "SET_REPO":
      return { ...state, repo: action.repo, repoSubpath: action.subpath };
    case "SET_CHARTS":
      return { ...state, charts: action.charts };
    case "SELECT_CHART":
      return { ...state, selectedChart: action.chart };
    case "SET_VALUES":
      return { ...state, valuesYaml: action.yaml, editedValuesYaml: action.yaml };
    case "SET_EDITED_VALUES":
      return { ...state, editedValuesYaml: action.yaml };
    case "SET_CONFIG_OPTIONS":
      return { ...state, configOptions: { ...state.configOptions, ...action.options } };
    case "SET_CHART_FILES":
      return { ...state, chartFiles: action.files };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

export function useWizard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    step: stepFromPath(location.pathname),
  });

  useEffect(() => {
    const targetPath = STEP_PATHS[state.step] || "/";
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [state.step, navigate, location.pathname]);

  const goTo = useCallback((step: number) => dispatch({ type: "SET_STEP", step }), []);
  const next = useCallback(() => dispatch({ type: "SET_STEP", step: state.step + 1 }), [state.step]);
  const back = useCallback(() => dispatch({ type: "SET_STEP", step: Math.max(0, state.step - 1) }), [state.step]);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return { state, dispatch, goTo, next, back, reset };
}
