"use client";

import { useEffect, useState } from "react";
import stylex from "~/lib/stylex";
import { buildUrl, fetchJson } from "../lib/api";

const styles = stylex.create({
  banner: {
    margin: "16px 32px",
    padding: "12px 16px",
    borderRadius: "12px",
    backgroundColor: "#fee2e2",
    color: "#7f1d1d",
    border: "1px solid #fecaca",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontSize: "13px",
  },
});

type MigrationStatus = {
  ok: boolean;
  appliedLatest?: string | null;
  expectedLatest?: string;
  missingCount?: number;
  missing?: string[];
  checkedAt?: string;
};

type HealthResponse = {
  migrations?: MigrationStatus;
};

export function DevMigrationBanner(): JSX.Element | null {
  const [status, setStatus] = useState<MigrationStatus | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let isMounted = true;
    const url = buildUrl("/health");
    fetchJson<HealthResponse>(url)
      .then((result) => {
        if (!isMounted) return;
        const migrations = result.data?.migrations;
        if (!migrations || migrations.ok) return;
        setStatus(migrations);
      })
      .catch(() => {
        if (!isMounted) return;
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!import.meta.env.DEV || !status) return null;

  return (
    <div className={stylex(styles.banner)}>
      <strong>DB migrations are out of date.</strong>
      <span>
        Applied: {status.appliedLatest ?? "none"}; expected: {status.expectedLatest ?? "unknown"}.
      </span>
      <span>
        Missing: {status.missingCount ?? "?"}. Run: wrangler d1 migrations apply &lt;db&gt;
      </span>
    </div>
  );
}
