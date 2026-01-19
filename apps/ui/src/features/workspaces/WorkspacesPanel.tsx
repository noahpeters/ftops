"use client";

import { useEffect, useState } from "react";
import stylex from "~/lib/stylex";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceRow,
} from "./api";

const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

const styles = stylex.create({
  panel: {
    padding: "24px 32px",
  },
  error: {
    color: "#b91c1c",
  },
  panelSub: {
    marginTop: "16px",
  },
  formGrid: {
    display: "grid",
    gap: "12px",
  },
  formRow: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  actions: {
    display: "flex",
    gap: "8px",
    marginTop: "10px",
    flexWrap: "wrap",
  },
  muted: {
    color: "#94a3b8",
  },
  tableWrap: {
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    overflowX: "auto",
  },
  dangerButton: {
    border: "1px solid #fecaca",
    backgroundColor: "#fee2e2",
    color: "#991b1b",
    padding: "6px 10px",
    borderRadius: "8px",
    cursor: "pointer",
    marginLeft: "6px",
  },
  secondaryButton: {
    border: "1px solid #94a3b8",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    padding: "6px 10px",
    borderRadius: "8px",
    cursor: "pointer",
  },
  empty: {
    color: "#94a3b8",
  },
  modal: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    width: "min(520px, 100%)",
  },
});

export function WorkspacesPanel({
  selectedWorkspaceId,
  onSelectWorkspace,
}: {
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (id: string | null) => void;
}): JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createSlug, setCreateSlug] = useState("");
  const [createName, setCreateName] = useState("");
  const [editTarget, setEditTarget] = useState<WorkspaceRow | null>(null);
  const [editSlug, setEditSlug] = useState("");
  const [editName, setEditName] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    const result = await listWorkspaces();
    if (result.ok) {
      setWorkspaces(result.data ?? []);
    } else {
      setError(result.text || "Failed to load workspaces.");
    }
    setLoading(false);
  }

  async function handleCreate() {
    if (!SLUG_REGEX.test(createSlug)) {
      setError("Slug must be 3-40 chars: lowercase letters, digits, hyphens.");
      return;
    }
    if (!createName.trim()) {
      setError("Name is required.");
      return;
    }
    const result = await createWorkspace({ slug: createSlug, name: createName });
    if (!result.ok) {
      setError(result.text || "Failed to create workspace.");
      return;
    }
    setCreateSlug("");
    setCreateName("");
    await refresh();
  }

  async function handleUpdate() {
    if (!editTarget) return;
    if (editSlug && !SLUG_REGEX.test(editSlug)) {
      setError("Slug must be 3-40 chars: lowercase letters, digits, hyphens.");
      return;
    }
    const result = await updateWorkspace(editTarget.id, {
      slug: editSlug || editTarget.slug || undefined,
      name: editName || editTarget.name,
    });
    if (!result.ok) {
      setError(result.text || "Failed to update workspace.");
      return;
    }
    setEditTarget(null);
    setEditSlug("");
    setEditName("");
    await refresh();
  }

  async function handleDelete(workspace: WorkspaceRow) {
    if (!confirm(`Delete workspace ${workspace.slug}?`)) {
      return;
    }
    setDeleteError(null);
    const result = await deleteWorkspace(workspace.id);
    if (!result.ok) {
      let message = result.text || "Delete failed.";
      if (result.data && typeof result.data === "object") {
        const payload = result.data as {
          error?: string;
          counts?: Record<string, number>;
        };
        if (payload.error === "workspace_not_empty" && payload.counts) {
          const detail = Object.entries(payload.counts)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ");
          message = `Workspace not empty. ${detail}`;
        }
        if (payload.error === "cannot_delete_default_workspace") {
          message = "Default workspace cannot be deleted.";
        }
      }
      setDeleteError(message);
      return;
    }
    if (selectedWorkspaceId === workspace.id) {
      onSelectWorkspace(null);
    }
    await refresh();
  }

  return (
    <section className={stylex(styles.panel)}>
      <h2>Workspaces</h2>
      {error && <div className={stylex(styles.error)}>{error}</div>}
      {deleteError && <div className={stylex(styles.error)}>{deleteError}</div>}

      <div className={stylex(styles.panelSub)}>
        <h3>Create Workspace</h3>
        <div className={stylex(styles.formGrid)}>
          <div className={stylex(styles.formRow)}>
            <label>Slug</label>
            <input
              value={createSlug}
              onChange={(event) => setCreateSlug(event.target.value)}
              placeholder="acme-production"
            />
          </div>
          <div className={stylex(styles.formRow)}>
            <label>Name</label>
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Acme Production"
            />
          </div>
        </div>
        <div className={stylex(styles.actions)}>
          <button type="button" onClick={handleCreate}>
            Create
          </button>
        </div>
      </div>

      <div className={stylex(styles.panelSub)}>
        <h3>Existing Workspaces</h3>
        {loading && <p className={stylex(styles.muted)}>Loading...</p>}
        <div className={stylex(styles.tableWrap)}>
          <table>
            <thead>
              <tr>
                <th>slug</th>
                <th>name</th>
                <th>created</th>
                <th>updated</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <td>{workspace.slug ?? "-"}</td>
                  <td>{workspace.name}</td>
                  <td>{workspace.created_at ?? "-"}</td>
                  <td>{workspace.updated_at ?? "-"}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        setEditTarget(workspace);
                        setEditSlug(workspace.slug ?? "");
                        setEditName(workspace.name);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={stylex(styles.dangerButton)}
                      onClick={() => handleDelete(workspace)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {workspaces.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className={stylex(styles.empty)}>
                    No workspaces yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editTarget && (
        <div className={stylex(styles.modal)}>
          <div className={stylex(styles.modalContent)}>
            <h3>Edit Workspace</h3>
            <div className={stylex(styles.formGrid)}>
              <div className={stylex(styles.formRow)}>
                <label>Slug</label>
                <input value={editSlug} onChange={(event) => setEditSlug(event.target.value)} />
              </div>
              <div className={stylex(styles.formRow)}>
                <label>Name</label>
                <input value={editName} onChange={(event) => setEditName(event.target.value)} />
              </div>
            </div>
            <div className={stylex(styles.actions)}>
              <button type="button" onClick={handleUpdate}>
                Save
              </button>
              <button
                type="button"
                className={stylex(styles.secondaryButton)}
                onClick={() => setEditTarget(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
