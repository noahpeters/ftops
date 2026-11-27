CREATE TABLE inquiry_templates (
 workspace_id TEXT NOT NULL, source TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 files TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(workspace_id,source)
);
CREATE TABLE inquiry_files (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, filename TEXT NOT NULL, bytes INTEGER NOT NULL
);
CREATE TABLE inquiry_settings (workspace_id TEXT PRIMARY KEY, mailbox TEXT NOT NULL);
CREATE TABLE inquiry_mail (
 submission_id TEXT NOT NULL REFERENCES website_submissions(id), kind TEXT NOT NULL,
 payload TEXT NOT NULL, actor TEXT, state TEXT NOT NULL DEFAULT 'pending',
 first_attempt INTEGER, next_attempt INTEGER NOT NULL DEFAULT 0, provider_id TEXT,
 PRIMARY KEY(submission_id,kind)
);
CREATE INDEX inquiry_mail_due ON inquiry_mail(state,next_attempt);
