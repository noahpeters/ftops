import PostalMime from "postal-mime";
import type { Env } from "../lib/types";
import { nowISO } from "../lib/utils";
import { enqueueQuoContactSync } from "./quo";

const DOODLE_MAILBOX = "doodle@ops.fromtrees.studio";

type DoodleBooking = {
  sourceMessageId: string | null;
  subject: string;
  inviteeName: string;
  inviteTitle: string;
  bookedTime: string | null;
  inviteUrl: string | null;
  fields: Record<string, string>;
  phone: string | null;
  address: string | null;
  budgetText: string | null;
  projectDescription: string | null;
};

type ContactMatch = {
  id: string;
  customer_id: string;
  display_name: string;
  phone: string | null;
};

type CustomerMatchResult = {
  contact: ContactMatch | null;
  ambiguous: boolean;
};

export async function processDoodleCustomerEmailIngestion(
  env: Env,
  ingestionId: string
): Promise<boolean> {
  const ingestion = await env.DB.prepare(`SELECT * FROM customer_email_ingestions WHERE id=?`)
    .bind(ingestionId)
    .first<Record<string, unknown>>();
  if (!ingestion) throw new Error("email_ingestion_not_found");
  if (["applied", "dismissed"].includes(String(ingestion.status))) return true;
  if (String(ingestion.envelope_to).trim().toLowerCase() !== DOODLE_MAILBOX) return false;

  const object = await env.R2_CUSTOMER_EMAILS_BUCKET.get(String(ingestion.raw_storage_key));
  if (!object) throw new Error("email_source_not_found");
  const raw = await object.arrayBuffer();
  const booking = await parseDoodleBooking(raw);
  if (!booking) return false;

  const workspaceId = String(ingestion.workspace_id);
  const now = nowISO();
  if (booking.sourceMessageId) {
    const duplicate = await env.DB.prepare(
      `SELECT id FROM customer_email_ingestions
       WHERE workspace_id=? AND message_id=? AND id<>? AND status IN ('applied','dismissed') LIMIT 1`
    )
      .bind(workspaceId, booking.sourceMessageId, ingestionId)
      .first();
    if (duplicate) {
      await env.DB.prepare(
        `UPDATE customer_email_ingestions
         SET message_id=?,subject=?,status='dismissed',failure_reason='duplicate_doodle_message_id',processed_at=?,updated_at=?
         WHERE id=?`
      )
        .bind(booking.sourceMessageId, booking.subject, now, now, ingestionId)
        .run();
      return true;
    }
  }

  const phone = normalizePhone(booking.phone);
  const matchResult = await findCustomerMatch(env, workspaceId, booking.inviteeName, phone);
  if (matchResult.ambiguous) {
    await env.DB.prepare(
      `UPDATE customer_email_ingestions
       SET original_sender_email='mailer@doodle.com',original_sender_name='Doodle',subject=?,message_id=?,status='needs_match',failure_reason='multiple_contact_matches',processed_at=?,updated_at=?
       WHERE id=?`
    )
      .bind(booking.subject, booking.sourceMessageId, now, now, ingestionId)
      .run();
    return true;
  }

  const match = matchResult.contact;
  const customerId = match?.customer_id || crypto.randomUUID();
  const contactId = match?.id || crypto.randomUUID();
  const names = splitName(booking.inviteeName);

  if (!match) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO customers
          (id,workspace_id,display_name,customer_type,status,lead_source,created_at,updated_at)
         VALUES (?,?,?,'person','lead','Doodle',?,?)`
      ).bind(customerId, workspaceId, booking.inviteeName, now, now),
      env.DB.prepare(
        `INSERT INTO contacts
          (id,workspace_id,customer_id,first_name,last_name,display_name,email,phone,role,status,is_primary,created_at,updated_at)
         VALUES (?,?,?,?,?,?,NULL,?,NULL,'active',1,?,?)`
      ).bind(
        contactId,
        workspaceId,
        customerId,
        names.firstName,
        names.lastName,
        booking.inviteeName,
        booking.phone,
        now,
        now
      ),
      env.DB.prepare(`UPDATE customers SET primary_contact_id=? WHERE id=?`).bind(
        contactId,
        customerId
      ),
    ]);
  } else if (booking.phone && !match.phone) {
    await env.DB.prepare(`UPDATE contacts SET phone=?,updated_at=? WHERE id=? AND workspace_id=?`)
      .bind(booking.phone, now, contactId, workspaceId)
      .run();
  }

  if (booking.address) {
    await upsertProjectAddress(env, workspaceId, customerId, booking.address, now);
  }

  const opportunityDescription =
    booking.projectDescription ||
    booking.fields.Topic ||
    booking.inviteTitle ||
    "Doodle consultation";
  const budgetCents = parseBudgetCents(booking.budgetText);
  if (!isAdministrativeBooking(booking)) {
    const opportunityType = classifyOpportunityType(opportunityDescription);
    await upsertDoodleOpportunity(env, {
      workspaceId,
      customerId,
      description: opportunityDescription,
      opportunityType,
      budgetCents,
      now,
    });
  }

  const activityId = crypto.randomUUID();
  const body = formatDoodleNote(booking, budgetCents);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO customer_activities
        (id,workspace_id,customer_id,activity_type,subject,body,source,occurred_at,created_by,created_at,is_human_authored)
       VALUES (?,?,?,'note',?,?,'doodle',?,NULL,?,0)`
    ).bind(
      activityId,
      workspaceId,
      customerId,
      `Doodle booking: ${booking.inviteTitle}`.slice(0, 200),
      body,
      booking.bookedTime ? validDate(booking.bookedTime) || now : now,
      now
    ),
    env.DB.prepare(
      `UPDATE customer_email_ingestions
       SET original_sender_email='mailer@doodle.com',original_sender_name='Doodle',contact_id=?,customer_id=?,subject=?,message_id=?,sent_at=?,status='applied',failure_reason=NULL,processed_at=?,reviewed_at=?,reviewed_by='system:doodle',updated_at=?
       WHERE id=?`
    ).bind(
      contactId,
      customerId,
      booking.subject,
      booking.sourceMessageId,
      booking.bookedTime ? validDate(booking.bookedTime) : null,
      now,
      now,
      now,
      ingestionId
    ),
  ]);

  await enqueueQuoContactSync(env, workspaceId, customerId, contactId);
  return true;
}

export async function parseDoodleBooking(raw: ArrayBuffer): Promise<DoodleBooking | null> {
  const parsed = await PostalMime.parse(raw);
  const rawText = new TextDecoder().decode(raw);
  const subject = normalizeSubject(parsed.subject || findHeader(rawText, "Subject") || "");
  const doodleSignal =
    normalizeEmail(parsed.from?.address).endsWith("@doodle.com") ||
    /X-Mailgun-Template-Name:\s*SE_PARTICIPATION_NOTIF_BOOKING_O/i.test(rawText) ||
    /From:\s*Doodle\s*<[^>]+@doodle\.com>/i.test(rawText);
  const subjectMatch = subject.match(/^New time booked for\s+(.+?)\s+w\/\s+(.+)$/i);
  if (!doodleSignal || !subjectMatch) return null;

  const html = parsed.html || "";
  const text = parsed.text || htmlToText(html);
  const inviteTitle = subjectMatch[1].trim();
  const inviteeName = subjectMatch[2].trim();
  if (!inviteTitle || !inviteeName) return null;

  const fields = extractInviteeFields(html, text);
  const bookedTime = extractBookedTime(html, text);
  const inviteUrl = extractInviteUrl(html);
  const phone = fieldValue(fields, ["Phone number", "Phone", "Mobile", "Telephone"]);
  const address = fieldValue(fields, [
    "Home Address",
    "Address",
    "Project Address",
    "Project Site",
  ]);
  const budgetText = fieldValue(fields, ["Your budget range", "Budget", "Budget range"]);
  const projectDescription = fieldValue(fields, [
    "Brief description of the project you'd like to discuss",
    "Brief description of the project you’d like to discuss",
    "Project description",
    "Topic",
  ]);

  return {
    sourceMessageId: parsed.messageId || normalizeMessageId(findHeader(rawText, "Message-Id")),
    subject,
    inviteeName,
    inviteTitle,
    bookedTime,
    inviteUrl,
    fields,
    phone: phone || null,
    address: address || null,
    budgetText: budgetText || null,
    projectDescription: projectDescription || null,
  };
}

async function findCustomerMatch(
  env: Env,
  workspaceId: string,
  inviteeName: string,
  phone: string | null
): Promise<CustomerMatchResult> {
  if (phone) {
    const contacts = await env.DB.prepare(
      `SELECT id,customer_id,display_name,phone FROM contacts
       WHERE workspace_id=? AND status<>'archived' AND phone IS NOT NULL`
    )
      .bind(workspaceId)
      .all<ContactMatch>();
    const matches = (contacts.results ?? []).filter((row) => normalizePhone(row.phone) === phone);
    if (matches.length === 1) return { contact: matches[0], ambiguous: false };
    if (matches.length > 1) return { contact: null, ambiguous: true };
  }
  const contacts = await env.DB.prepare(
    `SELECT id,customer_id,display_name,phone FROM contacts
     WHERE workspace_id=? AND status<>'archived' AND lower(display_name)=lower(?)`
  )
    .bind(workspaceId, inviteeName)
    .all<ContactMatch>();
  if (contacts.results?.length === 1) {
    return { contact: contacts.results[0], ambiguous: false };
  }
  return { contact: null, ambiguous: (contacts.results?.length ?? 0) > 1 };
}

export function isAdministrativeBooking(
  booking: Pick<DoodleBooking, "projectDescription" | "fields">
) {
  const text = [booking.projectDescription, booking.fields.Topic].filter(Boolean).join(" ");
  return /\breschedul(?:e|ed|ing)\b|\bprevious(?:ly)? scheduled\b/i.test(text);
}

async function upsertProjectAddress(
  env: Env,
  workspaceId: string,
  customerId: string,
  rawAddress: string,
  now: string
) {
  const parsed = parseAddress(rawAddress);
  const existing = await env.DB.prepare(
    `SELECT id,line1,line2,city,region,postal_code,country FROM customer_addresses
     WHERE workspace_id=? AND customer_id=?`
  )
    .bind(workspaceId, customerId)
    .all<Record<string, unknown>>();
  const target = normalizeAddress(rawAddress);
  const duplicate = (existing.results ?? []).some((row) =>
    normalizeAddress(
      [row.line1, row.line2, row.city, row.region, row.postal_code, row.country]
        .filter(Boolean)
        .join(" ")
    ).includes(target)
  );
  if (duplicate) return;
  await env.DB.prepare(
    `INSERT INTO customer_addresses
      (id,workspace_id,customer_id,address_type,line1,line2,city,region,postal_code,country,is_primary,created_at,updated_at)
     VALUES (?,?,?,'project_site',?,?,?,?,?,'US',1,?,?)`
  )
    .bind(
      crypto.randomUUID(),
      workspaceId,
      customerId,
      parsed.line1,
      null,
      parsed.city,
      parsed.region,
      parsed.postalCode,
      now,
      now
    )
    .run();
}

async function upsertDoodleOpportunity(
  env: Env,
  input: {
    workspaceId: string;
    customerId: string;
    description: string;
    opportunityType: string;
    budgetCents: number;
    now: string;
  }
) {
  const existing = await env.DB.prepare(
    `SELECT id,description,budget_cents FROM customer_opportunities
     WHERE workspace_id=? AND customer_id=? AND status='scoping'
     ORDER BY updated_at DESC`
  )
    .bind(input.workspaceId, input.customerId)
    .all<{ id: string; description: string; budget_cents: number }>();
  const normalized = normalizeText(input.description);
  const match = (existing.results ?? []).find(
    (row) =>
      normalizeText(row.description) === normalized ||
      normalizeText(row.description).includes(normalized) ||
      normalized.includes(normalizeText(row.description))
  );
  if (match) {
    if (input.budgetCents > 0 && (!match.budget_cents || match.budget_cents === 0)) {
      await env.DB.prepare(
        `UPDATE customer_opportunities SET budget_cents=?,updated_at=? WHERE id=?`
      )
        .bind(input.budgetCents, input.now, match.id)
        .run();
    }
    return;
  }
  await env.DB.prepare(
    `INSERT INTO customer_opportunities
      (id,workspace_id,customer_id,description,opportunity_type,budget_cents,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'scoping',?,?)`
  )
    .bind(
      crypto.randomUUID(),
      input.workspaceId,
      input.customerId,
      input.description,
      input.opportunityType,
      input.budgetCents,
      input.now,
      input.now
    )
    .run();
}

function extractInviteeFields(html: string, text: string) {
  const fields: Record<string, string> = {};
  const divs = [...html.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => cleanHtmlFragment(match[1]))
    .map((value) => value.trim())
    .filter(Boolean);
  const marker = divs.findIndex((value) => /Answers to your invitee fields:/i.test(value));
  if (marker >= 0) {
    for (let i = marker + 1; i + 1 < divs.length; i += 2) {
      const label = divs[i];
      const value = divs[i + 1];
      if (
        !label ||
        !value ||
        /^Go to the invite$/i.test(label) ||
        /^Go to the invite$/i.test(value)
      )
        break;
      if (
        /^(Hi\s|Doodle|Aug\s|Sep\s|Oct\s|Nov\s|Dec\s|Jan\s|Feb\s|Mar\s|Apr\s|May\s|Jun\s|Jul\s)/i.test(
          label
        )
      )
        continue;
      fields[label] = value;
    }
  }
  if (Object.keys(fields).length) return fields;

  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const textMarker = lines.findIndex((line) => /Answers to your invitee fields:/i.test(line));
  if (textMarker >= 0) {
    for (let i = textMarker + 1; i + 1 < lines.length; i += 2) {
      if (/^Go to the invite$/i.test(lines[i])) break;
      fields[lines[i]] = lines[i + 1];
    }
  }
  return fields;
}

function extractBookedTime(html: string, text: string) {
  const source = htmlToText(html) || text;
  const match = source.match(
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}\s+[AP]M\s+-\s+\d{1,2}:\d{2}\s+[AP]M\s+America\/[A-Za-z_]+(?:\s+\(GMT[+-]\d{2}:\d{2}\))?)/i
  );
  return match?.[1]?.trim() || null;
}

function extractInviteUrl(html: string) {
  const matches = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const target = matches.find((match) => /Go to the invite/i.test(cleanHtmlFragment(match[2])));
  return target?.[1] || null;
}

function fieldValue(fields: Record<string, string>, labels: string[]) {
  for (const [key, value] of Object.entries(fields)) {
    if (labels.some((label) => normalizeText(key) === normalizeText(label))) return value.trim();
  }
  return "";
}

export function parseBudgetCents(value: string | null | undefined) {
  if (!value) return 0;
  const numbers = [...value.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)(\s*k)?/gi)].map((match) => {
    const amount = Number(match[1].replace(/,/g, ""));
    return match[2] ? amount * 1000 : amount;
  });
  if (!numbers.length) return 0;
  const dollars = numbers.length >= 2 ? (numbers[0] + numbers[1]) / 2 : numbers[0];
  return Math.max(0, Math.round(dollars * 100));
}

export function classifyOpportunityType(description: string) {
  const value = normalizeText(description);
  if (
    /cabinet|kitchen|vanity|bath|built in|built-in|bookcase|closet|wardrobe|mudroom|bar\b|library/.test(
      value
    )
  )
    return "cabinets";
  if (/table|desk|chair|bench|bed\b|dresser|nightstand|coffee table|furniture/.test(value))
    return "furniture";
  return "other";
}

function formatDoodleNote(booking: DoodleBooking, budgetCents: number) {
  const lines = [
    `Meeting: ${booking.inviteTitle}`,
    booking.bookedTime ? `Scheduled: ${booking.bookedTime}` : null,
    booking.phone ? `Phone: ${booking.phone}` : null,
    booking.address ? `Project address: ${booking.address}` : null,
    booking.budgetText
      ? `Budget answer: ${booking.budgetText}${budgetCents > 0 ? ` (working budget: ${formatMoney(budgetCents)})` : ""}`
      : null,
    booking.projectDescription ? `Project: ${booking.projectDescription}` : null,
    ...Object.entries(booking.fields)
      .filter(
        ([key]) =>
          ![
            "phone number",
            "phone",
            "home address",
            "address",
            "your budget range",
            "budget",
            "budget range",
            "brief description of the project you'd like to discuss",
            "brief description of the project you’d like to discuss",
            "project description",
            "topic",
          ].includes(normalizeText(key))
      )
      .map(([key, value]) => `${key}: ${value}`),
    booking.inviteUrl ? `Doodle invite: ${booking.inviteUrl}` : null,
    booking.sourceMessageId ? `Source message: ${booking.sourceMessageId}` : null,
  ];
  return lines
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");
}

function parseAddress(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const zip = cleaned.match(/\b(\d{5}(?:-\d{4})?)\b/)?.[1] || null;
  const withoutZip = zip
    ? cleaned
        .replace(zip, "")
        .replace(/[,.\s]+$/, "")
        .trim()
    : cleaned;
  const stateMatch = withoutZip.match(/\b(CA|California)\b/i);
  const region = stateMatch ? "CA" : null;
  const beforeState = stateMatch
    ? withoutZip
        .slice(0, stateMatch.index)
        .replace(/[,.\s]+$/, "")
        .trim()
    : withoutZip;
  const streetMatch = beforeState.match(
    /^(.+?\b(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|way|blvd|boulevard|ct|court|pl|place)\.?)(?:\s+)(.+)$/i
  );
  return {
    line1: streetMatch?.[1]?.trim() || beforeState || cleaned,
    city: streetMatch?.[2]?.trim() || null,
    region,
    postalCode: zip,
  };
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

function normalizePhone(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
function normalizeAddress(value: unknown) {
  return normalizeText(String(value || ""))
    .replace(/\busa?\b/g, "")
    .trim();
}
function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeSubject(value: string) {
  return value.replace(/^\s*(?:(?:fwd?|re):\s*)+/i, "").trim();
}
function normalizeEmail(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, "");
}
function normalizeMessageId(value: string | null | undefined) {
  const result = String(value || "").trim();
  return result || null;
}
function findHeader(raw: string, name: string) {
  const match = raw.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || null;
}
function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|td|tr|table|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
function cleanHtmlFragment(value: string) {
  return htmlToText(value).replace(/\s+/g, " ").trim();
}
function validDate(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.replace(/\s+\(GMT[+-]\d{2}:\d{2}\)\s*$/i, "");
  const timestamp = Date.parse(cleaned);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}
function formatMoney(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
