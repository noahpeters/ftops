CREATE TABLE h2_inquiry_jobs (
 integration_id TEXT NOT NULL,event_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('ftops','resend')),
 payload TEXT NOT NULL,notify_staff INTEGER NOT NULL,state TEXT NOT NULL,
 attempts INTEGER NOT NULL,next_attempt INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,receipt TEXT,PRIMARY KEY(integration_id,event_id,kind)
);
CREATE INDEX h2_inquiry_jobs_due ON h2_inquiry_jobs(integration_id,state,next_attempt);
