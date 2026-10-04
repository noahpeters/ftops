import stylex from "~/lib/stylex";
import { colors } from "../../theme/tokens.stylex";
const styles = stylex.create({
  section: {
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    paddingBottom: 16,
    marginBottom: 16,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  correction: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    flexBasis: "100%",
  },
  indicator: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 6,
    backgroundColor: colors.neutralBg,
  },
  qualified: { backgroundColor: colors.successBg, color: colors.successText },
  notQualified: { backgroundColor: colors.warnBg, color: colors.warnText },
});
import { useState } from "react";
import {
  qualificationAction,
  type CustomerDetail,
  type QualificationClass,
  type Qualification,
} from "./api";
const labels: Record<QualificationClass, string> = {
  qualified: "Qualified",
  not_qualified: "Not qualified",
  unclear: "Unclear",
};
export function CustomerQualification({
  customerId,
  qualification,
  onChange,
}: {
  customerId: string;
  qualification?: Qualification;
  onChange: (detail: CustomerDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [expected, setExpected] = useState<QualificationClass>("qualified");
  const current = qualification?.current;
  const review = qualification?.reviews.find((row) => row.assessment_id === current?.id);
  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await qualificationAction(customerId, body);
      if (!result.ok || !result.data) {
        setError("Unable to save qualification. Please try again.");
        return;
      }
      onChange(result.data);
      setCorrecting(false);
    } catch {
      setError("Unable to save qualification. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={stylex(styles.section)} aria-label="Customer qualification">
      <p>
        <strong
          className={stylex(
            styles.indicator,
            current?.classification === "qualified" && styles.qualified,
            current?.classification === "not_qualified" && styles.notQualified
          )}
        >
          Qualification: {current ? labels[current.classification] : "Not assessed"}
        </strong>
      </p>
      {current && <p>Assessed {new Date(current.created_at).toLocaleString()}</p>}
      {review && (
        <p>
          Review:{" "}
          {review.verdict === "correct"
            ? "Correct"
            : `Incorrect — expected ${labels[review.expected_classification].toLowerCase()}`}{" "}
          · {new Date(review.reviewed_at).toLocaleString()}
        </p>
      )}
      <div className={stylex(styles.actions)}>
        <button type="button" disabled={busy} onClick={() => void submit({ action: "classify" })}>
          {busy ? "Saving…" : current ? "Reassess project scope" : "Assess project scope"}
        </button>
        {current && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void submit({ action: "review", assessmentId: current.id, verdict: "correct" })
              }
            >
              Classification is correct
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setExpected(current.classification === "qualified" ? "not_qualified" : "qualified");
                setCorrecting(true);
              }}
            >
              Classification is incorrect
            </button>
            {correcting && (
              <div className={stylex(styles.correction)}>
                <label>
                  Expected classification{" "}
                  <select
                    value={expected}
                    onChange={(event) => setExpected(event.target.value as QualificationClass)}
                  >
                    {(Object.keys(labels) as QualificationClass[])
                      .filter((key) => key !== current.classification)
                      .map((key) => (
                        <option key={key} value={key}>
                          {labels[key]}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void submit({
                      action: "review",
                      assessmentId: current.id,
                      verdict: "incorrect",
                      expectedClassification: expected,
                    })
                  }
                >
                  Save review
                </button>
                <button type="button" disabled={busy} onClick={() => setCorrecting(false)}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Qualification criteria and history</summary>
        <p>
          Custom furniture and cabinetry project scope only. Budget, location, and timing do not
          determine qualification. Reviews are saved for future evaluation and do not change the
          original assessment.
        </p>
        <ul>
          {qualification?.assessments.map((row) => {
            const evaluation = qualification.reviews.find((item) => item.assessment_id === row.id);
            return (
              <li key={row.id}>
                {new Date(row.created_at).toLocaleString()} · {labels[row.classification]} ·{" "}
                {evaluation ? `Reviewed ${evaluation.verdict}` : "Not reviewed"}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
