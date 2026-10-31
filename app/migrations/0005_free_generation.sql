-- 限时免费生图：全局 1000 份 + 每浏览器 2 次。付费链路保留但默认休眠。
CREATE TABLE IF NOT EXISTS free_quota (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 1000,
  per_browser INTEGER NOT NULL DEFAULT 2,
  used INTEGER NOT NULL DEFAULT 0,
  last_request_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO free_quota (id, total, per_browser, used, last_request_id) VALUES (1, 1000, 2, 0, NULL);

CREATE TABLE IF NOT EXISTS free_usage (
  browser_key TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0,
  last_request_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS free_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  quota_ok INTEGER NOT NULL DEFAULT 0,
  browser_ok INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS free_requests_created ON free_requests(created_at);

CREATE TABLE IF NOT EXISTS free_quota_refunds (
  attempt_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  browser_key TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS free_quota_refunds_order ON free_quota_refunds(order_id);

CREATE TABLE IF NOT EXISTS free_feedback (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  test_id TEXT NOT NULL,
  satisfied INTEGER NOT NULL CHECK (satisfied IN (0, 1)),
  price_fen INTEGER CHECK (price_fen IS NULL OR price_fen IN (100, 200, 600)),
  price_answered INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  pet_type TEXT,
  role_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE orders ADD COLUMN free_browser_key TEXT;
ALTER TABLE orders ADD COLUMN free_request_id TEXT;
ALTER TABLE orders ADD COLUMN free_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN free_quota_charged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN free_quota_refunded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN free_refund_attempt_id TEXT;
