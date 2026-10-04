-- Classification and evaluation are independent of lifecycle status and downstream destinations.
CREATE TABLE customer_qualification_assessments (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 classification TEXT NOT NULL CHECK(classification IN ('qualified','not_qualified','unclear')),
 confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
 probabilities_json TEXT NOT NULL, model TEXT NOT NULL, rules_version TEXT NOT NULL,
 rules_snapshot TEXT NOT NULL, input_snapshot TEXT NOT NULL,
 source_type TEXT NOT NULL, source_id TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE INDEX customer_qualification_customer_idx ON customer_qualification_assessments(workspace_id,customer_id,created_at);
CREATE TABLE customer_qualification_reviews (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 assessment_id TEXT NOT NULL, verdict TEXT NOT NULL CHECK(verdict IN ('correct','incorrect')),
 expected_classification TEXT NOT NULL CHECK(expected_classification IN ('qualified','not_qualified','unclear')),
 reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL,
 FOREIGN KEY(assessment_id) REFERENCES customer_qualification_assessments(id) ON DELETE CASCADE,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE INDEX customer_qualification_review_idx ON customer_qualification_reviews(workspace_id,assessment_id,reviewed_at);
