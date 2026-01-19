import stylex from "~/lib/stylex";
import { colors } from "../theme/tokens.stylex";
import { useEffect, useState } from "react";

const styles = stylex.create({
  banner: {
    backgroundColor: colors.accent,
    color: colors.surface,
    padding: "12px 16px",
    fontSize: "12px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  label: {
    fontWeight: 600,
    marginRight: "8px",
  },
  value: {
    fontFamily: "ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});

export function ServerStatus(): JSX.Element {
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    setNow(new Date().toISOString());
  }, []);

  return (
    <div className={stylex(styles.banner)}>
      <span className={stylex(styles.label)}>Server time</span>
      <span className={stylex(styles.value)}>{now || "—"}</span>
    </div>
  );
}
