import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { Badge, Button, MenuButton, Status } from "@from-trees/ui";
import { gap, layout } from "@from-trees/ui/utilities";
import {
  getQualification,
  qualificationAction,
  type CustomerDetail,
  type Qualification,
  type QualificationClass,
} from "./api";

export function CustomerQualification({
  customerId,
  qualification,
  classification,
  onChange,
}: {
  customerId: string;
  qualification?: Qualification;
  classification?: QualificationClass | null;
  onChange: (detail: CustomerDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = qualification?.current?.classification ?? classification;

  async function assess(classification?: "qualified" | "not_qualified") {
    setBusy(true);
    setError("");
    try {
      const result = await qualificationAction(
        customerId,
        classification ? { action: "confirm_scope", classification } : { action: "classify" }
      );
      if (!result.ok || !result.data?.qualification?.current) throw new Error("No assessment");
      onChange(result.data);
    } catch {
      setError(
        classification
          ? "Unable to record staff qualification."
          : "Unable to assess project scope. You can review it manually."
      );
    } finally {
      setBusy(false);
    }
  }

  async function review(verdict: "correct" | "incorrect") {
    setBusy(true);
    setError("");
    try {
      const current = qualification?.current ?? (await getQualification(customerId)).data?.current;
      if (
        !current ||
        (current.classification !== "qualified" && current.classification !== "not_qualified")
      )
        throw new Error("No assessment");
      const result = await qualificationAction(customerId, {
        action: "review",
        assessmentId: current.id,
        verdict,
        ...(verdict === "incorrect"
          ? {
              expectedClassification:
                current.classification === "qualified" ? "not_qualified" : "qualified",
            }
          : {}),
      });
      if (!result.ok || !result.data) throw new Error("Unable to save");
      onChange(result.data);
    } catch {
      setError("Unable to save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (value !== "qualified" && value !== "not_qualified") {
    if (!qualification) return null;
    return (
      <div {...stylex.props(layout.stack, gap.sm)}>
        {value === "unclear" && <Status tone="warning">Project scope is unclear.</Status>}
        <div {...stylex.props(layout.row, layout.wrap, gap.sm)}>
          <Button busy={busy} onPress={() => void assess()}>
            Assess project scope
          </Button>
          <MenuButton
            label="Confirm manually"
            text="Confirm manually"
            actions={[
              {
                id: "qualified",
                label: "Confirm qualified",
                disabled: busy,
                onAction: () => void assess("qualified"),
              },
              {
                id: "unqualified",
                label: "Confirm unqualified",
                disabled: busy,
                onAction: () => void assess("not_qualified"),
              },
            ]}
          />
        </div>
        {error && <Status tone="danger">{error}</Status>}
      </div>
    );
  }
  return (
    <div {...stylex.props(layout.stack, gap.sm)}>
      <div {...stylex.props(layout.row, layout.wrap, layout.alignCenter, gap.sm)}>
        <Badge tone={value === "qualified" ? "success" : "warning"}>
          {value === "qualified" ? "Qualified" : "Unqualified"}
        </Badge>
        <MenuButton
          label="Review assessment"
          text="Review assessment"
          actions={[
            {
              id: "correct",
              label: "Good evaluation",
              disabled: busy,
              onAction: () => void review("correct"),
            },
            {
              id: "incorrect",
              label: "Bad evaluation",
              disabled: busy,
              onAction: () => void review("incorrect"),
            },
          ]}
        />
      </div>
      {busy && <Status>Updating qualification…</Status>}
      {error && <Status tone="danger">{error}</Status>}
    </div>
  );
}
