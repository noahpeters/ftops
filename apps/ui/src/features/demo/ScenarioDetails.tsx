import type { DemoScenario } from "./scenarios";

type ScenarioDetailsProps = {
  scenario: DemoScenario;
};

export function ScenarioDetails({ scenario }: ScenarioDetailsProps): JSX.Element {
  return (
    <div className="scenario-details">
      <h3>{scenario.name}</h3>
      <p>{scenario.description}</p>
    </div>
  );
}
