ALTER TABLE orders ADD COLUMN paid_at INTEGER;
ALTER TABLE orders ADD COLUMN buyer_id TEXT;
ALTER TABLE orders ADD COLUMN delivered_at INTEGER;
ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN link_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE payment_inbox (
  trade_no TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  error_code TEXT
);
CREATE INDEX payment_inbox_due ON payment_inbox(state,next_at);
CREATE TABLE payment_transactions (
  trade_no TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id), buyer_id TEXT,
  amount_fen INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'paid',
  verified_at INTEGER NOT NULL, custom_order_id TEXT
);
CREATE TABLE delivery_jobs (
  order_id TEXT PRIMARY KEY REFERENCES orders(id), state TEXT NOT NULL DEFAULT 'pending',
  attempt_id TEXT, next_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  error_code TEXT
);
CREATE INDEX delivery_jobs_due ON delivery_jobs(state,next_at);
CREATE TABLE generation_attempts (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
  state TEXT NOT NULL, stage TEXT NOT NULL, started_at INTEGER NOT NULL,
  finished_at INTEGER, request_id TEXT, http_status INTEGER,
  elapsed_ms INTEGER, error_code TEXT, image_key TEXT
);
CREATE TABLE avatar_notifications (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), event TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
  error_code TEXT, sent_at INTEGER, UNIQUE(order_id,event)
);
CREATE TABLE refund_requests (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), trade_no TEXT,
  reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
  amount_fen INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL, reviewed_at INTEGER, review_note TEXT,
  channel TEXT, proof_reference TEXT, refunded_at INTEGER
);
CREATE UNIQUE INDEX refund_one_active ON refund_requests(order_id) WHERE state IN ('pending','needs_info','approved','processing','error');
CREATE TABLE avatar_audit (
  id TEXT PRIMARY KEY, order_id TEXT, action TEXT NOT NULL,
  detail TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE delivery_control (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER NOT NULL);
