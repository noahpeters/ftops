import { useEffect, useState } from "react";
import { buildUrl, fetchJson } from "../lib/api";

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
    <div className="dev-banner">
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
