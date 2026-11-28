import { canAccessWorkspace, canAdminWorkspace, requireActor } from "../lib/access";
import { badRequest, forbidden, json, notFound, methodNotAllowed } from "../lib/http";
import type { SegmentHandler } from "../lib/router";
import {
  defaultTemplate,
  deliver,
  describe,
  type FileRef,
  type Mail,
  type Submission,
  type Template,
} from "../services/inquiryMail";

const maxBytes = 5 * 1024 * 1024;
const maxFiles = 12;
const replyFrom = "hello@fromtrees.studio";
const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function validFilename(name: string) {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !/[/\\]/.test(name) &&
    !Array.from(name).some((c) => c.charCodeAt(0) < 32)
  );
}

async function readUpload(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(new Uint8Array(value).buffer);
  }
  return new Blob(chunks);
}

type ReplyInput = { subject?: string; text?: string; files?: string[]; cc?: string[] };

async function readReply(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data"))
    return { input: (await request.json()) as ReplyInput | null, uploads: [] };
  // Leave room for UTF-8 message text and multipart headers.
  const body = await readUpload(request, maxBytes + 256 * 1024);
  if (!body) return null;
  const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  const metadata = form.get("reply");
  if (typeof metadata !== "string") return null;
  return { input: JSON.parse(metadata) as ReplyInput | null, uploads: form.getAll("attachment") };
}

function mailFields(mail: Mail) {
  return { from: mail.from, replyTo: mail.reply_to, cc: mail.cc ?? [] };
}
export const handleInquiryReplies: SegmentHandler = async (
  [workspace, action, id, ...extra],
  request,
  env,
  ctx
) => {
  const auth = await requireActor(env, request);
  if (!auth.ok) return auth.response;
  if (!workspace || !canAccessWorkspace(auth.actor, workspace)) return forbidden("forbidden");
  if (extra.length) return notFound("Route not found");
  const db = env.DB;
  const templates = async () =>
    (
      await db
        .prepare("SELECT source, subject,body,files FROM inquiry_templates WHERE workspace_id=?")
        .bind(workspace)
        .all<Template & { source: string }>()
    ).results;
  const mailbox = async () =>
    await db
      .prepare("SELECT mailbox FROM inquiry_settings WHERE workspace_id=?")
      .bind(workspace)
      .first<string>("mailbox");
  if (["settings", "files", "templates"].includes(action)) {
    if (!canAdminWorkspace(auth.actor, workspace)) return forbidden("forbidden");
    if (id) return notFound("Route not found");
    if (request.method === "GET" && action === "settings") {
      const files = (
        await db
          .prepare(
            "SELECT id,filename,bytes FROM inquiry_files WHERE workspace_id=? ORDER BY filename"
          )
          .bind(workspace)
          .all<FileRef>()
      ).results;
      return json({
        mailbox: (await mailbox()) || "",
        templates: await templates(),
        files,
        defaultTemplate,
      });
    }
    if (request.method !== "POST") return methodNotAllowed(["POST"]);
    if (action === "files") {
      const name = new URL(request.url).searchParams.get("filename")?.trim();
      if (!name || !validFilename(name)) return badRequest("Invalid filename");
      if (!request.body) return badRequest("Empty file");
      const file = await readUpload(request, maxBytes);
      if (!file) return badRequest("Attachment limit is 5 MB");
      if (!file.size) return badRequest("Empty file");
      const key = crypto.randomUUID();
      await env.R2_CUSTOMER_EMAILS_BUCKET.put("inquiry-templates/" + key, file);
      await db
        .prepare("INSERT INTO inquiry_files VALUES(?,?,?,?)")
        .bind(key, workspace, name, file.size)
        .run();
      return json({ id: key, filename: name, bytes: file.size }, 201);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return badRequest("Invalid settings");
    if (action === "settings") {
      if (typeof body.mailbox !== "string" || !emailPattern.test(body.mailbox))
        return badRequest("Enter a valid team email");
      await db
        .prepare(
          "INSERT INTO inquiry_settings VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET mailbox=excluded.mailbox"
        )
        .bind(workspace, body.mailbox)
        .run();
      return json({ saved: true });
    }
    const { source, subject, text, files } = body;
    if (
      typeof source !== "string" ||
      !source.trim() ||
      source.length > 256 ||
      typeof subject !== "string" ||
      !subject.trim() ||
      /[\r\n]/.test(subject) ||
      subject.length > 240 ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 16000 ||
      !Array.isArray(files) ||
      files.length > maxFiles
    )
      return badRequest("Invalid template");
    const refs: FileRef[] = [];
    for (const key of new Set(files)) {
      if (typeof key !== "string") return badRequest("Invalid attachment");
      const ref = await db
        .prepare("SELECT id,filename,bytes FROM inquiry_files WHERE workspace_id=? AND id=?")
        .bind(workspace, key)
        .first<FileRef>();
      if (!ref) return badRequest("Invalid attachment");
      refs.push(ref);
    }
    if (refs.reduce((sum, x) => sum + x.bytes, 0) > maxBytes)
      return badRequest("Attachments together must fit within 5 MB");
    await db
      .prepare(
        "INSERT INTO inquiry_templates VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,source) DO UPDATE SET subject=excluded.subject,body=excluded.body,files=excluded.files"
      )
      .bind(workspace, source, subject, text, JSON.stringify(refs))
      .run();
    return json({ saved: true });
  }
  if (!id) return notFound("Route not found");
  if (action === "customer" && request.method === "GET") {
    const rows = (
      await db
        .prepare(
          "SELECT s.id,s.email,s.workspace_id,s.customer_id,s.received_at,s.fields_json,m.state,m.payload FROM website_submissions s LEFT JOIN inquiry_mail m ON m.submission_id=s.id AND m.kind='reply' WHERE s.workspace_id=? AND s.customer_id=? ORDER BY received_at DESC"
        )
        .bind(workspace, id)
        .all<Submission & { state: string | null; payload: string | null }>()
    ).results;
    const options = await templates();
    return json(
      rows.map((row) => {
        const { source, project, fields } = describe(row);
        const saved = row.payload ? (JSON.parse(row.payload) as Mail) : null;
        const template =
          options.find((t) => t.source === source) ??
          options.find((t) => t.source === "default") ??
          defaultTemplate;
        const expand = (text: string) =>
          text.replace(/{{(\w+)}}/g, (token, key: string) => fields[key] ?? token);
        return {
          id: row.id,
          email: row.email,
          source,
          project,
          received: row.received_at,
          state: row.state,
          ...(saved
            ? mailFields(saved)
            : { from: replyFrom, replyTo: auth.actor.email, cc: [auth.actor.email] }),
          subject:
            saved?.subject ??
            expand(template.subject)
              .replace(/[\r\n]+/g, " ")
              .slice(0, 240),
          text: saved?.text ?? expand(template.body),
          files: saved?.files ?? JSON.parse(template.files),
        };
      })
    );
  }
  if (action === "send" && request.method === "POST") {
    const row = await db
      .prepare(
        "SELECT * FROM website_submissions WHERE id=? AND workspace_id=? AND customer_id IS NOT NULL"
      )
      .bind(id, workspace)
      .first<Submission>();
    if (!row) return notFound("Inquiry not found");
    const reply = await readReply(request).catch(() => null);
    if (!reply) return badRequest("Invalid reply or attachment limit exceeded");
    const { input, uploads } = reply;
    if (
      typeof input?.subject !== "string" ||
      !input.subject.trim() ||
      /[\r\n]/.test(input.subject) ||
      input.subject.length > 240 ||
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.length > 40000 ||
      !Array.isArray(input.files)
    )
      return badRequest("Invalid reply");
    const options = await templates();
    const template =
      options.find((t) => t.source === describe(row).source) ??
      options.find((t) => t.source === "default") ??
      defaultTemplate;
    const available = JSON.parse(template.files) as FileRef[];
    if (input.files.some((key) => !available.some((f) => f.id === key)))
      return badRequest("Template attachments changed. Reopen the draft.");
    const files = available.filter((f) => input.files!.includes(f.id));
    if (files.length + uploads.length > maxFiles)
      return badRequest("A response can have up to 12 attachments");
    const attachments: File[] = [];
    let bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    for (const file of uploads) {
      if (typeof file === "string" || !file.size || !validFilename(file.name))
        return badRequest("Invalid attachment");
      bytes += file.size;
      attachments.push(file);
    }
    if (bytes > maxBytes) return badRequest("Attachments together must fit within 5 MB");

    const replyTo = auth.actor.email;
    if (!emailPattern.test(replyTo)) return forbidden("A signed-in email is required");
    const extraCc = input.cc === undefined ? [] : input.cc;
    if (!Array.isArray(extraCc) || extraCc.length > 49)
      return badRequest("Enter up to 49 additional CC addresses");
    const cc = new Map([[replyTo.toLowerCase(), replyTo]]);
    for (const value of extraCc) {
      if (typeof value !== "string" || value.length > 254 || !emailPattern.test(value.trim()))
        return badRequest("Enter valid CC email addresses");
      const address = value.trim();
      const key = address.toLowerCase();
      if (!cc.has(key) && key !== row.email.toLowerCase()) cc.set(key, address);
    }
    if (!env.RESEND_API_KEY) return badRequest("Inquiry email delivery is unavailable");

    const findReply = () =>
      db
        .prepare("SELECT state,payload FROM inquiry_mail WHERE submission_id=? AND kind='reply'")
        .bind(id)
        .first<{ state: string; payload: string }>();
    const response = ({ state, payload }: { state: string; payload: string }) => {
      const mail = JSON.parse(payload) as Mail;
      return json(
        {
          state,
          ...mailFields(mail),
          subject: mail.subject,
          text: mail.text,
          files: mail.files ?? [],
        },
        202
      );
    };
    const existing = await findReply();
    if (existing) return response(existing);

    const bucket = env.R2_CUSTOMER_EMAILS_BUCKET;
    const keys: string[] = [];
    try {
      for (const file of attachments) {
        const id = crypto.randomUUID();
        const key = "inquiry-replies/" + id;
        keys.push(key);
        await bucket.put(key, file);
        files.push({ id, filename: file.name, bytes: file.size, replyUpload: true });
      }
    } catch (error) {
      if (keys.length) await bucket.delete(keys);
      throw error;
    }
    const payload: Mail = {
      from: replyFrom,
      to: row.email,
      reply_to: replyTo,
      cc: Array.from(cc.values()),
      subject: input.subject,
      text: input.text,
      files,
    };
    const result = await db
      .prepare(
        "INSERT INTO inquiry_mail(submission_id,kind,payload,actor) VALUES(?,'reply',?,?) ON CONFLICT DO NOTHING"
      )
      .bind(id, JSON.stringify(payload), replyTo)
      .run();
    if (result.meta.changes) ctx.waitUntil(deliver(env, id, "reply"));
    else if (keys.length) ctx.waitUntil(bucket.delete(keys));
    const queued = await findReply();
    return queued ? response(queued) : notFound("Reply not found");
  }
  return notFound("Route not found");
};
