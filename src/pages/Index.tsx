import { useState, useCallback, useEffect } from "react";
import { useWizard } from "@/hooks/use-wizard";
import { WizardLayout } from "@/components/WizardLayout";
import { StepSearch } from "@/components/StepSearch";
import { StepHelmDetection } from "@/components/StepHelmDetection";
import { StepValuesEditor } from "@/components/StepValuesEditor";
import { StepGenerate } from "@/components/StepGenerate";

function useConfigCount() {
  const [count, setCount] = useState(() =>
    parseInt(localStorage.getItem("byocify-configs") || "0", 10)
  );
  const increment = useCallback(() => {
    setCount((prev) => {
      const next = prev + 1;
      localStorage.setItem("byocify-configs", String(next));
      return next;
    });
  }, []);
  return { count, increment };
}

const TOTAL_STEPS = 3;

const Index = () => {
  const { state, dispatch, reset } = useWizard();
  const { count, increment } = useConfigCount();

  useEffect(() => {
    const needsRepo = state.step >= 1 && !state.repo;
    const needsChart = state.step >= 2 && !state.selectedChart;
    if (needsRepo || needsChart) {
      dispatch({ type: "SET_STEP", step: 0 });
    }
  }, [state.step, state.repo, state.selectedChart, dispatch]);

  return (
    <WizardLayout
      currentStep={state.step}
      totalSteps={TOTAL_STEPS}
      configCount={count}
      onReset={reset}
    >
      <div key={state.step} className="animate-step-in">
        {state.step === 0 && (
          <StepSearch
            dispatch={dispatch}
            onNext={() => dispatch({ type: "SET_STEP", step: 1 })}
            configCount={count}
          />
        )}
        {state.step === 1 && state.repo && (
          <StepHelmDetection
            repo={state.repo}
            subpath={state.repoSubpath}
            dispatch={dispatch}
            onNext={() => dispatch({ type: "SET_STEP", step: 2 })}
            onBack={() => dispatch({ type: "SET_STEP", step: 0 })}
          />
        )}
        {state.step === 2 && state.repo && state.selectedChart && (
          <StepValuesEditor
            repo={state.repo}
            chart={state.selectedChart}
            valuesYaml={state.editedValuesYaml}
            configOptions={state.configOptions}
            dispatch={dispatch}
            onNext={() => dispatch({ type: "SET_STEP", step: 3 })}
            onBack={() => dispatch({ type: "SET_STEP", step: 1 })}
          />
        )}
        {state.step === 3 && state.repo && state.selectedChart && (
          <StepGenerate
            repo={state.repo}
            chart={state.selectedChart}
            valuesYaml={state.editedValuesYaml}
            configOptions={state.configOptions}
            onBack={() => dispatch({ type: "SET_STEP", step: 2 })}
            onReset={reset}
            onGenerated={increment}
          />
        )}
      </div>
    </WizardLayout>
  );
};

export default Index;
