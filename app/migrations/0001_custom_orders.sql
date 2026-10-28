CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  photo_id TEXT NOT NULL REFERENCES photos(id),
  amount_fen INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  platform_order_no TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  retryable INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  image_key TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_gate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_check_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO payment_gate (id) VALUES (1);
