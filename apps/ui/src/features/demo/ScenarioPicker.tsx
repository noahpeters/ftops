import type { DemoScenario } from "./scenarios";
import stylex from "~/lib/stylex";

const styles = stylex.create({
  picker: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
});

type ScenarioPickerProps = {
  scenarios: DemoScenario[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function ScenarioPicker({
  scenarios,
  selectedId,
  onSelect,
}: ScenarioPickerProps): JSX.Element {
  return (
    <div className={stylex(styles.picker)}>
      <label>
        Scenario
        <select value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          {scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
