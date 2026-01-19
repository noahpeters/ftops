import type { DemoScenario } from "./scenarios";
import stylex from "~/lib/stylex";

const styles = stylex.create({
  details: {
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    backgroundColor: "#ffffff",
  },
});

type ScenarioDetailsProps = {
  scenario: DemoScenario;
};

export function ScenarioDetails({ scenario }: ScenarioDetailsProps): JSX.Element {
  return (
    <div className={stylex(styles.details)}>
      <h3>{scenario.name}</h3>
      <p>{scenario.description}</p>
    </div>
  );
}
