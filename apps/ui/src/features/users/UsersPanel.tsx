"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import stylex from "~/lib/stylex";
import { colors, radius, spacing } from "../../theme/tokens.stylex";
import { createUser, deleteUser, listUsers, updateUser, type WorkspaceUser } from "./api";

const styles = stylex.create({
  panel: {
    padding: "24px 32px",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  metaText: {
    fontSize: "14px",
    lineHeight: "1.5",
    color: colors.textMuted,
  },
  form: {
    display: "grid",
    gap: spacing.md,
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    marginBottom: spacing.lg,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
  },
  input: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: "14px",
  },
  checkboxRow: {
    display: "flex",
    gap: spacing.sm,
    alignItems: "center",
  },
  actions: {
    display: "flex",
    gap: spacing.sm,
    flexWrap: "wrap",
    alignItems: "center",
  },
  tableWrap: {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: colors.textSubtle,
    padding: "10px 12px",
    borderBottom: `1px solid ${colors.border}`,
    backgroundColor: colors.surfaceAlt,
  },
  td: {
    padding: "10px 12px",
    borderBottom: `1px solid ${colors.border}`,
    fontSize: "14px",
  },
  rowActions: {
    display: "flex",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  error: {
    color: colors.errorText,
    fontSize: "14px",
  },
});

type Props = {
  workspaceId: string | null;
  canEditSystemAdmin?: boolean;
};

export function UsersPanel({ workspaceId, canEditSystemAdmin = false }: Props): JSX.Element {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [workspaceAdmin, setWorkspaceAdmin] = useState(false);
  const [systemAdmin, setSystemAdmin] = useState(false);

  const normalizedUsers = useMemo(
    () =>
      users.map((user) => ({
        ...user,
        workspace_admin: Boolean(user.workspace_admin),
        system_admin: Boolean(user.system_admin),
      })),
    [users]
  );

  const loadUsers = useCallback(async () => {
    if (!workspaceId) {
      setUsers([]);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await listUsers(workspaceId);
    if (!result.ok) {
      setError(result.text || "Failed to load users.");
      setUsers([]);
    } else {
      setUsers(result.data ?? []);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function handleCreate() {
    if (!workspaceId) return;
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      setError("Name and email are required.");
      return;
    }
    const result = await createUser(workspaceId, {
      name: trimmedName,
      email: trimmedEmail,
      workspace_admin: workspaceAdmin,
      system_admin: systemAdmin,
    });
    if (!result.ok) {
      setError(result.text || "Failed to create user.");
      return;
    }
    setName("");
    setEmail("");
    setWorkspaceAdmin(false);
    setSystemAdmin(false);
    await loadUsers();
  }

  async function handleUpdate(
    user: WorkspaceUser,
    changes: {
      name?: string;
      email?: string;
      workspace_admin?: boolean;
      system_admin?: boolean;
    }
  ) {
    if (!workspaceId) return;
    const result = await updateUser(workspaceId, user.user_id, changes);
    if (!result.ok) {
      setError(result.text || "Failed to update user.");
      return;
    }
    await loadUsers();
  }

  async function handleDelete(user: WorkspaceUser) {
    if (!workspaceId) return;
    const result = await deleteUser(workspaceId, user.user_id);
    if (!result.ok) {
      setError(result.text || "Failed to delete user.");
      return;
    }
    await loadUsers();
  }

  return (
    <section className={stylex(styles.panel)}>
      <div className={stylex(styles.header)}>
        <div>
          <h2>Users</h2>
          <span className={stylex(styles.metaText)}>
            {workspaceId ? `Workspace: ${workspaceId}` : "Select a workspace to manage users."}
          </span>
        </div>
        <button type="button" onClick={loadUsers} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className={stylex(styles.error)}>{error}</div>}

      <div className={stylex(styles.form)}>
        <div className={stylex(styles.field)}>
          <label>Name</label>
          <input
            className={stylex(styles.input)}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className={stylex(styles.field)}>
          <label>Email</label>
          <input
            className={stylex(styles.input)}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className={stylex(styles.field)}>
          <label>Roles</label>
          <div className={stylex(styles.checkboxRow)}>
            <label className={stylex(styles.checkboxRow)}>
              <input
                type="checkbox"
                checked={workspaceAdmin}
                onChange={(event) => setWorkspaceAdmin(event.target.checked)}
              />
              Workspace admin
            </label>
            <label className={stylex(styles.checkboxRow)}>
              <input
                type="checkbox"
                checked={systemAdmin}
                onChange={(event) => setSystemAdmin(event.target.checked)}
                disabled={!canEditSystemAdmin}
              />
              System admin
            </label>
          </div>
        </div>
        <div className={stylex(styles.actions)}>
          <button type="button" onClick={handleCreate} disabled={!workspaceId}>
            Add user
          </button>
        </div>
      </div>

      <div className={stylex(styles.tableWrap)}>
        <table className={stylex(styles.table)}>
          <thead>
            <tr>
              <th className={stylex(styles.th)}>Workspace</th>
              <th className={stylex(styles.th)}>Name</th>
              <th className={stylex(styles.th)}>Email</th>
              <th className={stylex(styles.th)}>Workspace admin</th>
              <th className={stylex(styles.th)}>System admin</th>
              <th className={stylex(styles.th)}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {normalizedUsers.length === 0 && (
              <tr>
                <td className={stylex(styles.td)} colSpan={6}>
                  {workspaceId ? "No users yet." : "Select a workspace to view users."}
                </td>
              </tr>
            )}
            {normalizedUsers.map((user) => (
              <tr key={user.user_id}>
                <td className={stylex(styles.td)}>{user.workspace_id}</td>
                <td className={stylex(styles.td)}>
                  <input
                    className={stylex(styles.input)}
                    value={user.name}
                    onChange={(event) =>
                      setUsers((prev) =>
                        prev.map((entry) =>
                          entry.user_id === user.user_id
                            ? { ...entry, name: event.target.value }
                            : entry
                        )
                      )
                    }
                    onBlur={() => void handleUpdate(user, { name: user.name })}
                  />
                </td>
                <td className={stylex(styles.td)}>
                  <input
                    className={stylex(styles.input)}
                    value={user.email}
                    onChange={(event) =>
                      setUsers((prev) =>
                        prev.map((entry) =>
                          entry.user_id === user.user_id
                            ? { ...entry, email: event.target.value }
                            : entry
                        )
                      )
                    }
                    onBlur={() => void handleUpdate(user, { email: user.email })}
                  />
                </td>
                <td className={stylex(styles.td)}>
                  <input
                    type="checkbox"
                    checked={user.workspace_admin}
                    onChange={(event) =>
                      void handleUpdate(user, { workspace_admin: event.target.checked })
                    }
                  />
                </td>
                <td className={stylex(styles.td)}>
                  <input
                    type="checkbox"
                    checked={user.system_admin}
                    onChange={(event) =>
                      void handleUpdate(user, { system_admin: event.target.checked })
                    }
                    disabled={!canEditSystemAdmin}
                  />
                </td>
                <td className={stylex(styles.td)}>
                  <div className={stylex(styles.rowActions)}>
                    <button type="button" onClick={() => void handleDelete(user)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
