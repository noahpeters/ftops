import { websiteAcquisitionIntegration } from "../lib/websiteAcquisitionIntegration";
import type { Env } from "../lib/types";
import { handleH2WebsiteIntake } from "../routes/websiteIntake";

type Kind = "ftops" | "resend";
type Transfer = {
  id: string;
  notifyStaff: boolean;
  intake: { externalEventId: string };
  acknowledgement: { event: string };
  destinations: {
    kind: Kind;
    state: "pending" | "sending";
    attempts: number;
    nextAttempt: number;
  }[];
};
type Job = {
  event_id: string;
  kind: Kind;
  payload: string;
  attempts: number;
  notify_staff: number;
};

async function importTransfers(env: Env, integration: string) {
  const queue = env.H2_INQUIRY_QUEUE!;
  const response = await queue.fetch("https://queue.internal/pending");
  if (!response.ok) throw Error("queue_read_failed");
  const records = (await response.json()) as Transfer[];
  for (const row of records) {
    if (
      row.intake.externalEventId !== row.id ||
      row.acknowledgement.event !== "inquiry.received" ||
      !row.destinations.length
    )
      throw Error("invalid_inquiry_transfer");
    await env.DB.batch(
      row.destinations.map((d) => {
        const ambiguous = d.kind === "resend" && d.state === "sending";
        return env.DB.prepare(
          `INSERT INTO h2_inquiry_jobs(integration_id,event_id,kind,payload,notify_staff,state,attempts,next_attempt,last_error)
     VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(integration_id,event_id,kind) DO NOTHING`
        ).bind(
          integration,
          row.id,
          d.kind,
          JSON.stringify(d.kind === "ftops" ? row.intake : row.acknowledgement),
          Number(row.notifyStaff),
          ambiguous ? "review" : "pending",
          d.attempts,
          d.nextAttempt,
          ambiguous ? "ambiguous_interrupted_send" : null
        );
      })
    );
    const ack = await queue.fetch("https://queue.internal/received", {
      method: "POST",
      body: JSON.stringify({ id: row.id }),
    });
    if (!ack.ok) throw Error("queue_ack_failed");
  }
}

async function processJob(env: Env, ctx: ExecutionContext, integration: string, job: Job) {
  const now = Date.now();
  const key = [integration, job.event_id, job.kind];
  const claim = await env.DB.prepare(
    `UPDATE h2_inquiry_jobs SET state='sending',attempts=attempts+1,lease_until=?
 WHERE integration_id=? AND event_id=? AND kind=? AND state='pending' AND next_attempt<=? RETURNING attempts`
  )
    .bind(now + 120000, ...key, now)
    .first<number>("attempts");
  if (!claim) return;
  async function settle(state: string, error: string | null, receipt: unknown = null) {
    await env.DB.prepare(
      `UPDATE h2_inquiry_jobs SET state=?,last_error=?,receipt=?,next_attempt=?,lease_until=0
   WHERE integration_id=? AND event_id=? AND kind=? AND attempts=? AND state='sending'`
    )
      .bind(
        state,
        error,
        receipt === null ? null : JSON.stringify(receipt),
        Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(claim! - 1, 6)),
        ...key,
        claim
      )
      .run();
  }
  const acknowledgement = job.kind === "resend";
  if (acknowledgement && !env.RESEND_API_KEY) {
    await settle("pending", "email_not_configured");
    return;
  }
  let result: Response;
  try {
    result = acknowledgement
      ? await fetch("https://api.resend.com/events/send", {
          method: "POST",
          headers: {
            authorization: "Bearer " + env.RESEND_API_KEY,
            "content-type": "application/json",
            "idempotency-key": "inquiry-" + job.event_id,
          },
          body: job.payload,
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        })
      : await handleH2WebsiteIntake(
          new Request("https://ftops.internal/h2-inquiry", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(job.notify_staff ? { "X-Inquiry-Notification": "ftops" } : {}),
            },
            body: job.payload,
          }),
          env,
          ctx
        );
  } catch {
    await settle(acknowledgement ? "review" : "pending", "network_or_processing_error");
    return;
  }
  if (!result.ok) {
    const retry = result.status === 429 || (!acknowledgement && result.status >= 500);
    await settle(retry ? "pending" : "review", "http_" + result.status);
    return;
  }
  const receipt = (await result.json().catch(() => null)) as {
    object?: string;
    event?: string;
    submissionId?: string;
    status?: string;
    duplicate?: boolean;
    staffNotificationQueued?: boolean;
  } | null;
  const valid =
    receipt &&
    (acknowledgement
      ? receipt.object === "event" && receipt.event === "inquiry.received"
      : receipt.submissionId &&
        ["linked", "needs_review"].includes(receipt.status || "") &&
        typeof receipt.duplicate === "boolean" &&
        (!job.notify_staff || receipt.staffNotificationQueued));
  if (!valid) {
    await settle(acknowledgement ? "review" : "pending", "invalid_receipt");
    return;
  }
  await settle("sent", null, receipt);
}

export async function processH2Inquiries(env: Env, ctx: ExecutionContext) {
  if (!env.H2_INQUIRY_QUEUE) return;
  const integration = await websiteAcquisitionIntegration(env);
  if (!integration?.is_active) return;
  // An H2 outage must not prevent processing work already accepted into FTOPS.
  try {
    await importTransfers(env, integration.id);
  } catch {
    console.error("h2_inquiry_transfer_pending");
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE h2_inquiry_jobs SET state=CASE WHEN kind='resend' THEN 'review' ELSE 'pending' END,last_error='interrupted_send'
 WHERE integration_id=? AND state='sending' AND lease_until<=?`
  )
    .bind(integration.id, now)
    .run();
  const jobs = await env.DB.prepare(
    `SELECT event_id,kind,payload,attempts,notify_staff FROM h2_inquiry_jobs
 WHERE integration_id=? AND state='pending' AND next_attempt<=? ORDER BY next_attempt,event_id LIMIT 12`
  )
    .bind(integration.id, now)
    .all<Job>();
  for (const job of jobs.results) await processJob(env, ctx, integration.id, job);
}
