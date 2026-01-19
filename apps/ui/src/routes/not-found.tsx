import stylex from "~/lib/stylex";
import { colors, spacing } from "../theme/tokens.stylex";

const styles = stylex.create({
  wrap: {
    padding: spacing.xl,
    color: colors.textMuted,
  },
});

export default function NotFound(): JSX.Element {
  return (
    <section className={stylex(styles.wrap)}>
      <h2>Not Found</h2>
      <p>That page does not exist.</p>
    </section>
  );
}
