"use client";

import type { ReactNode } from "react";
import stylex from "~/lib/stylex";
import { colors, radius, spacing } from "../theme/tokens.stylex";

const styles = stylex.create({
  overlay: {
    position: "fixed",
    zIndex: 50,
    inset: 0,
    border: 0,
    backgroundColor: "rgba(47, 33, 24, 0.18)",
  },
  drawer: {
    position: "fixed",
    zIndex: 51,
    top: 0,
    right: 0,
    height: "100vh",
    width: "420px",
    maxWidth: "92vw",
    boxSizing: "border-box",
    backgroundColor: colors.surface,
    borderLeft: `1px solid ${colors.border}`,
    padding: "20px 18px",
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    overflowY: "auto",
    boxShadow: "-12px 0 32px rgba(47, 33, 24, 0.12)",
    "@media (max-width: 600px)": {
      width: "100vw",
      maxWidth: "100vw",
      padding: "16px",
    },
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  heading: {
    minWidth: 0,
  },
  eyebrow: {
    fontSize: "12px",
    lineHeight: "1.4",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: colors.textSubtle,
  },
  title: {
    margin: 0,
    fontSize: "20px",
    lineHeight: "1.4",
    fontWeight: 600,
  },
  actions: {
    display: "flex",
    gap: spacing.sm,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  button: {
    minHeight: "36px",
    padding: "7px 12px",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    cursor: "pointer",
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    color: colors.surface,
  },
  cancelButton: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
  },
  buttonDisabled: {
    cursor: "not-allowed",
    opacity: 0.5,
  },
});

type Props = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onSave?: () => void;
  formId?: string;
  saveDisabled?: boolean;
  saving?: boolean;
  saveLabel?: string;
};

export function RightSideEditor({
  eyebrow,
  title,
  children,
  onCancel,
  onSave,
  formId,
  saveDisabled = false,
  saving = false,
  saveLabel = "Save",
}: Props): JSX.Element {
  const saveIsDisabled = saveDisabled || saving;
  return (
    <>
      <button
        type="button"
        className={stylex(styles.overlay)}
        aria-label={`Cancel ${eyebrow.toLowerCase()} editing`}
        onClick={onCancel}
        disabled={saving}
      />
      <aside className={stylex(styles.drawer)} aria-label={`${eyebrow} editor`}>
        <header className={stylex(styles.header)}>
          <div className={stylex(styles.heading)}>
            <div className={stylex(styles.eyebrow)}>{eyebrow}</div>
            <h2 className={stylex(styles.title)}>{title}</h2>
          </div>
          <div className={stylex(styles.actions)}>
            <button
              type={formId ? "submit" : "button"}
              form={formId}
              className={stylex(
                styles.button,
                styles.saveButton,
                saveIsDisabled && styles.buttonDisabled
              )}
              onClick={onSave}
              disabled={saveIsDisabled}
            >
              {saving ? "Saving…" : saveLabel}
            </button>
            <button
              type="button"
              className={stylex(
                styles.button,
                styles.cancelButton,
                saving && styles.buttonDisabled
              )}
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </header>
        {children}
      </aside>
    </>
  );
}
