import { Outlet } from "react-router";
import stylex from "~/lib/stylex";
import { colors, spacing } from "../theme/tokens.stylex";

const styles = stylex.create({
  shell: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.text,
  },
  container: {
    width: "100%",
    maxWidth: "760px",
    margin: "0 auto",
    padding: `${spacing.xl} ${spacing.lg}`,
  },
});

export default function LegalLayout(): JSX.Element {
  return (
    <main className={stylex(styles.shell)}>
      <div className={stylex(styles.container)}>
        <Outlet />
      </div>
    </main>
  );
}
