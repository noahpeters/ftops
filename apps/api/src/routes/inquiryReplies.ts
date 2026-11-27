import { canAccessWorkspace, canAdminWorkspace, requireActor } from "../lib/access";
import { badRequest, forbidden, json, notFound, methodNotAllowed } from "../lib/http";
import type { SegmentHandler } from "../lib/router";
import {
  defaultTemplate,
  deliver,
  describe,
  type FileRef,
  type Submission,
  type Template,
} from "../services/inquiryMail";

const maxBytes = 5 * 1024 * 1024;
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
      if (
        !name ||
        name.length > 200 ||
        /[/\\]/.test(name) ||
        Array.from(name).some((c) => c.charCodeAt(0) < 32)
      )
        return badRequest("Invalid filename");
      const reader = request.body?.getReader();
      if (!reader) return badRequest("Empty file");
      const chunks: ArrayBuffer[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return badRequest("Attachment limit is 5 MB");
        }
        chunks.push(new Uint8Array(value).buffer);
      }
      if (!size) return badRequest("Empty file");
      const key = crypto.randomUUID();
      await env.R2_CUSTOMER_EMAILS_BUCKET.put("inquiry-templates/" + key, new Blob(chunks));
      await db
        .prepare("INSERT INTO inquiry_files VALUES(?,?,?,?)")
        .bind(key, workspace, name, size)
        .run();
      return json({ id: key, filename: name, bytes: size }, 201);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return badRequest("Invalid settings");
    if (action === "settings") {
      if (
        typeof body.mailbox !== "string" ||
        !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(body.mailbox)
      )
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
      files.length > 12
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
        const saved = row.payload ? JSON.parse(row.payload) : null;
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
    const input = (await request.json().catch(() => null)) as {
      subject?: string;
      text?: string;
      files?: string[];
    } | null;
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
    const address = await mailbox();
    if (!address || !env.DAILY_SUMMARY_FROM_EMAIL || !env.RESEND_API_KEY)
      return badRequest("Configure the team email in Templates before sending");
    const payload = {
      from: env.DAILY_SUMMARY_FROM_EMAIL,
      to: row.email,
      reply_to: address,
      subject: input.subject,
      text: input.text,
      files: available.filter((f) => input.files!.includes(f.id)),
    };
    const result = await db
      .prepare(
        "INSERT INTO inquiry_mail(submission_id,kind,payload,actor) VALUES(?,'reply',?,?) ON CONFLICT DO NOTHING"
      )
      .bind(id, JSON.stringify(payload), auth.actor.email)
      .run();
    if (result.meta.changes) ctx.waitUntil(deliver(env, id, "reply"));
    return json(
      {
        state: await db
          .prepare("SELECT state FROM inquiry_mail WHERE submission_id=? AND kind='reply'")
          .bind(id)
          .first("state"),
      },
      202
    );
  }
  return notFound("Route not found");
};
