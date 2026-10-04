import { useEffect, useRef, useState } from "react";
import stylex from "~/lib/stylex";
import { colors } from "../../theme/tokens.stylex";
import {
  getQualification,
  qualificationAction,
  type CustomerDetail,
  type Qualification,
  type QualificationClass,
} from "./api";

const styles = stylex.create({
  root: { position: "relative", width: "fit-content", marginTop: 4, marginBottom: 4 },
  circle: {
    width: 24,
    height: 24,
    padding: 0,
    borderRadius: "50%",
    border: `1px solid ${colors.border}`,
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  qualified: { backgroundColor: colors.successBg, color: colors.successText },
  unqualified: { backgroundColor: colors.warnBg, color: colors.warnText },
  menu: {
    position: "absolute",
    top: 28,
    left: 0,
    zIndex: 10,
    minWidth: 170,
    padding: 4,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    backgroundColor: colors.surfaceAlt,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    display: "grid",
    gap: 4,
  },
});

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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const value = qualification?.current?.classification ?? classification;
  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (value !== "qualified" && value !== "not_qualified") return null;
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
      setOpen(false);
      trigger.current?.focus();
    } catch {
      setError("Unable to save. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      ref={root}
      className={stylex(styles.root)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
        if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const items = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
          );
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          items[
            (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
          ]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={stylex(
          styles.circle,
          value === "qualified" ? styles.qualified : styles.unqualified
        )}
        aria-label={value === "qualified" ? "Qualified" : "Unqualified"}
        title={value === "qualified" ? "Qualified" : "Unqualified"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setError("");
          setOpen(!open);
        }}
      >
        {value === "qualified" ? "Q" : "U"}
      </button>
      {open && (
        <div role="menu" aria-label="Evaluate qualification" className={stylex(styles.menu)}>
          <button
            ref={firstItem}
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void review("correct")}
          >
            Good evaluation
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void review("incorrect")}
          >
            Bad evaluation
          </button>
          {error && <span role="alert">{error}</span>}
        </div>
      )}
    </div>
  );
}
