import { useReducer, useCallback } from "react";
import type { WizardState, WizardAction } from "@/lib/types";

const initialState: WizardState = {
  step: 0,
  repo: null,
  charts: [],
  selectedChart: null,
  valuesYaml: "",
  editedValuesYaml: "",
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
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

export function useWizard() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const goTo = useCallback((step: number) => dispatch({ type: "SET_STEP", step }), []);
  const next = useCallback(() => dispatch({ type: "SET_STEP", step: state.step + 1 }), [state.step]);
  const back = useCallback(() => dispatch({ type: "SET_STEP", step: Math.max(0, state.step - 1) }), [state.step]);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return { state, dispatch, goTo, next, back, reset };
}
