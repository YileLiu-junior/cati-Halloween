ALTER TABLE orders ADD COLUMN primary_refunded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_jobs ADD COLUMN recovery_id TEXT;
ALTER TABLE refund_requests ADD COLUMN review_id TEXT;
