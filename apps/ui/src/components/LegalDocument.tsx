import type { ReactNode } from "react";
import stylex from "~/lib/stylex";
import { colors, spacing } from "../theme/tokens.stylex";

const styles = stylex.create({
  article: {
    lineHeight: 1.7,
  },
  title: {
    marginTop: 0,
    marginBottom: spacing.sm,
  },
  metadata: {
    marginTop: 0,
    marginBottom: spacing.xl,
    color: colors.textMuted,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
  },
  paragraph: {
    margin: 0,
  },
  publisher: {
    marginTop: spacing.xl,
    color: colors.textMuted,
  },
});

export function LegalDocument({
  title,
  effectiveDate,
  effectiveDateLabel,
  children,
}: {
  title: string;
  effectiveDate: string;
  effectiveDateLabel?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <article className={stylex(styles.article)}>
      <header>
        <h1 className={stylex(styles.title)}>{title}</h1>
        <p className={stylex(styles.metadata)}>
          {effectiveDateLabel ?? "Effective Date:"} {effectiveDate}
        </p>
      </header>
      <div className={stylex(styles.body)}>{children}</div>
      <p className={stylex(styles.publisher)}>Published by from trees, LLC</p>
    </article>
  );
}

export const legalParagraph = styles.paragraph;
