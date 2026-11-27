import { useEffect, useState } from "react";
import { buildUrl, fetchJson } from "../../lib/api";

type FileRef = { id: string; filename: string; bytes: number };
type Template = { source: string; subject: string; body: string; files: string };
type Settings = {
  mailbox: string;
  templates: Template[];
  files: FileRef[];
  defaultTemplate: Template;
};
type Inquiry = {
  id: string;
  email: string;
  source: string;
  project: string;
  received: string;
  state: string | null;
  subject: string;
  text: string;
  files: FileRef[];
};
const sources = [
  "default",
  "contact",
  "furniture",
  "cabinetry",
  "designers",
  "table_study",
  "cabinet_study",
  "cabinet_price",
  "cabinet_share",
];
const labels: Record<string, string> = {
  default: "Default for other inquiries",
  contact: "General contact",
  furniture: "Furniture",
  cabinetry: "Cabinetry",
  designers: "Designers",
  table_study: "Table configurator",
  cabinet_study: "Cabinet configurator",
  cabinet_price: "Cabinet pricing",
  cabinet_share: "Cabinet sharing",
};
function endpoint(workspace: string, action: string) {
  return buildUrl("/inquiry-replies/" + encodeURIComponent(workspace) + "/" + action);
}
async function call<T>(url: string, init?: RequestInit) {
  const result = await fetchJson<T>(url, init);
  if (!result.ok || !result.data)
    throw new Error(
      (result.data as { error?: string } | null)?.error || "Unable to complete the request"
    );
  return result.data;
}
function post(body: unknown) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Request failed";
}
export function InquirySettings({ workspace }: { workspace: string }) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [source, setSource] = useState("default"),
    [mailbox, setMailbox] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    call<Settings>(endpoint(workspace, "settings"))
      .then((s) => {
        if (live) {
          setSettings(s);
          setMailbox(s.mailbox);
        }
      })
      .catch((e) => live && setMessage(errorText(e)));
    return () => {
      live = false;
    };
  }, [workspace]);
  const selectedTemplate =
    settings?.templates.find((t) => t.source === source) ??
    settings?.templates.find((t) => t.source === "default") ??
    settings?.defaultTemplate;
  useEffect(() => {
    const t = selectedTemplate;
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
    setFiles(JSON.parse(t.files).map((f: FileRef) => f.id));
  }, [source, selectedTemplate]);
  async function save(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details data-inquiry-form>
      <summary>Inquiry email settings</summary>
      <p>Choose the team inbox for new inquiry alerts and customer replies.</p>
      <fieldset disabled={busy || !settings}>
        <label>
          Team email
          <input type="email" value={mailbox} onChange={(e) => setMailbox(e.target.value)} />
        </label>
        <button
          onClick={() =>
            save(async () => {
              await call(endpoint(workspace, "settings"), post({ mailbox }));
              setMessage("Team inbox saved.");
            })
          }
        >
          Save team inbox
        </button>
      </fieldset>
      <fieldset disabled={busy || !settings}>
        <legend>Response template</legend>
        <label>
          Inquiry entry point
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {sources.map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subject
          <input value={subject} maxLength={240} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          Email text
          <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <p>Insert a field in the email text</p>
        {["first_name", "last_name", "name", "project_type", "project_description"].map((key) => (
          <button key={key} onClick={() => setBody(body + "{{" + key + "}}")}>
            {key.replace(/_/g, " ")}
          </button>
        ))}
        <p>Standard attachments (5 MB combined)</p>
        {settings?.files.map((f) => (
          <label key={f.id}>
            <input
              type="checkbox"
              checked={files.includes(f.id)}
              onChange={(e) =>
                setFiles(e.target.checked ? [...files, f.id] : files.filter((k) => k !== f.id))
              }
            />
            {f.filename}
          </label>
        ))}
        <label>
          Add attachment to library
          <input
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f)
                void save(async () => {
                  if (f.size > 5242880) throw new Error("Attachment exceeds 5 MB");
                  const ref = await call<FileRef>(
                    endpoint(workspace, "files") + "?filename=" + encodeURIComponent(f.name),
                    { method: "POST", body: f }
                  );
                  setSettings((s) => s && { ...s, files: [...s.files, ref] });
                  setFiles((prev) => [...prev, ref.id]);
                });
            }}
          />
        </label>
        <button
          onClick={() =>
            save(async () => {
              await call(
                endpoint(workspace, "templates"),
                post({ source, subject, text: body, files })
              );
              setSettings(await call<Settings>(endpoint(workspace, "settings")));
              setMessage("Template saved.");
            })
          }
        >
          Save response template
        </button>
      </fieldset>
      <p role="status">{message}</p>
    </details>
  );
}

export function InquiryReplies({ workspace, customer }: { workspace: string; customer: string }) {
  const [rows, setRows] = useState<Inquiry[]>([]),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await call<Inquiry[]>(
          endpoint(workspace, "customer/" + encodeURIComponent(customer))
        );
        if (live) {
          setRows(data);
          if (data.some((x) => x.state === "pending")) timer = setTimeout(load, 10000);
        }
      } catch (e) {
        if (live) setError(errorText(e));
      }
    }
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [workspace, customer, revision]);
  const target = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("inquiry");
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {!!rows.length && (
        <section data-inquiry-form>
          <h3>Website inquiries</h3>
          {rows.map((row) => (
            <InquiryDraft
              key={row.id}
              row={row}
              focus={row.id === target}
              send={async (subject, text, files) => {
                const result = await call<{ state: string }>(
                  endpoint(workspace, "send/" + row.id),
                  post({ subject, text, files })
                );
                setRevision((v) => v + 1);
                setRows((prev) =>
                  prev.map((x) => (x.id === row.id ? { ...x, state: result.state } : x))
                );
              }}
            />
          ))}
        </section>
      )}
    </>
  );
}
function InquiryDraft({
  row,
  focus,
  send,
}: {
  row: Inquiry;
  focus: boolean;
  send: (subject: string, text: string, files: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(focus),
    [subject, setSubject] = useState(row.subject),
    [text, setText] = useState(row.text),
    [files, setFiles] = useState(row.files.map((f) => f.id)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <article>
      <strong>{labels[row.source] || row.source}</strong> ·{" "}
      {new Date(row.received).toLocaleDateString()}
      <p style={{ whiteSpace: "pre-wrap" }}>{row.project}</p>
      {row.state ? (
        <details>
          <summary>
            {row.state === "sent"
              ? "Reply sent"
              : row.state === "pending"
                ? "Reply queued for delivery"
                : "Delivery needs review"}
          </summary>
          <p>To {row.email}</p>
          <strong>{row.subject}</strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{row.text}</p>
          {row.files.map((f) => (
            <span key={f.id}>{f.filename} </span>
          ))}
        </details>
      ) : open ? (
        <fieldset disabled={busy}>
          <legend>Reply to {row.email}</legend>
          <label>
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label>
            Message
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {row.files.map((f) => (
            <label key={f.id}>
              <input
                type="checkbox"
                checked={files.includes(f.id)}
                onChange={(e) =>
                  setFiles(e.target.checked ? [...files, f.id] : files.filter((k) => k !== f.id))
                }
              />
              {f.filename}
            </label>
          ))}
          <button
            disabled={!subject.trim() || !text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await send(subject, text, files);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Send response
          </button>
          <button onClick={() => setOpen(false)}>Close draft</button>
          {error && <p role="alert">{error}</p>}
        </fieldset>
      ) : (
        <button onClick={() => setOpen(true)}>Respond to inquiry</button>
      )}
    </article>
  );
}

export function UnmatchedInquiry({ workspace, id }: { workspace: string; id: string }) {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    call<{ email: string; fields_json: string }>(
      buildUrl("/website-submissions/" + encodeURIComponent(id), { workspaceId: workspace })
    )
      .then((row) => {
        const f = JSON.parse(row.fields_json);
        if (live)
          setNotice(
            "Customer match needs review for " + (f.name || row.email) + " (" + row.email + ")."
          );
      })
      .catch((e) => live && setNotice(errorText(e)));
    return () => {
      live = false;
    };
  }, [workspace, id]);
  return <p role="status">{notice}</p>;
}
