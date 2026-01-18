import { useEffect, useState } from "react";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceRow,
} from "./api";

const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

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
    <section className="panel">
      <h2>Workspaces</h2>
      {error && <div className="error">{error}</div>}
      {deleteError && <div className="error">{deleteError}</div>}

      <div className="panel-sub">
        <h3>Create Workspace</h3>
        <div className="form-grid">
          <div className="form-row">
            <label>Slug</label>
            <input
              value={createSlug}
              onChange={(event) => setCreateSlug(event.target.value)}
              placeholder="acme-production"
            />
          </div>
          <div className="form-row">
            <label>Name</label>
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Acme Production"
            />
          </div>
        </div>
        <div className="actions">
          <button type="button" onClick={handleCreate}>
            Create
          </button>
        </div>
      </div>

      <div className="panel-sub">
        <h3>Existing Workspaces</h3>
        {loading && <p className="muted">Loading...</p>}
        <div className="table-wrap">
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
                      className="danger"
                      onClick={() => handleDelete(workspace)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {workspaces.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="empty">
                    No workspaces yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editTarget && (
        <div className="modal">
          <div className="modal-content">
            <h3>Edit Workspace</h3>
            <div className="form-grid">
              <div className="form-row">
                <label>Slug</label>
                <input value={editSlug} onChange={(event) => setEditSlug(event.target.value)} />
              </div>
              <div className="form-row">
                <label>Name</label>
                <input value={editName} onChange={(event) => setEditName(event.target.value)} />
              </div>
            </div>
            <div className="actions">
              <button type="button" onClick={handleUpdate}>
                Save
              </button>
              <button type="button" className="secondary" onClick={() => setEditTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
