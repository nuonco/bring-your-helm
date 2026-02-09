import { useWizard } from "@/hooks/use-wizard";
import { WizardLayout } from "@/components/WizardLayout";
import { StepSearch } from "@/components/StepSearch";
import { StepHelmDetection } from "@/components/StepHelmDetection";
import { StepValuesEditor } from "@/components/StepValuesEditor";
import { StepGenerate } from "@/components/StepGenerate";

const Index = () => {
  const { state, dispatch, next, back, reset } = useWizard();

  return (
    <WizardLayout currentStep={state.step} onReset={reset}>
      {state.step === 0 && (
        <StepSearch
          dispatch={dispatch}
          onNext={() => dispatch({ type: "SET_STEP", step: 1 })}
        />
      )}
      {state.step === 1 && state.repo && (
        <StepHelmDetection
          repo={state.repo}
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
          onBack={() => dispatch({ type: "SET_STEP", step: 2 })}
          onReset={reset}
        />
      )}
    </WizardLayout>
  );
};

export default Index;
