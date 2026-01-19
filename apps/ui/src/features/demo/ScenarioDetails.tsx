import type { DemoScenario } from "./scenarios";
import stylex from "~/lib/stylex";
import { colors } from "../../theme/tokens.stylex";

const styles = stylex.create({
  details: {
    padding: "12px",
    borderRadius: "8px",
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.surface,
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
