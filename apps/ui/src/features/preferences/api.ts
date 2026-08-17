import { buildUrl, fetchJson } from "../../lib/api";

export type UserPreferences = {
  customer_status_filters?: string[];
  left_rail_collapsed?: boolean;
};

export function getPreferences() {
  return fetchJson<UserPreferences>(buildUrl("/preferences"));
}

export function setPreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
  return fetchJson<{ key: K; value: UserPreferences[K] }>(buildUrl(`/preferences/${key}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
}
