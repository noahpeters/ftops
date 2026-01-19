import stylex from "~/lib/stylex";
import { colors } from "./theme/tokens.stylex";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "./styles.css";

const styles = stylex.create({
  body: {
    backgroundColor: colors.background,
    color: colors.text,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
});

export default function Root(): JSX.Element {
  return (
    <html lang="en">
      <head suppressHydrationWarning>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/virtual:stylex.css" suppressHydrationWarning />
        <Meta />
        <Links />
      </head>
      <body className={stylex(styles.body)}>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
