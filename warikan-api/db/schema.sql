-- Warikan-kun commercial-core PostgreSQL schema draft.
-- This is the source-of-truth shape for replacing Google Sheets as the transaction ledger.

CREATE TABLE users (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  default_paypay_id TEXT,
  default_payment_label TEXT NOT NULL DEFAULT 'PayPay',
  default_deadline_hour TEXT NOT NULL DEFAULT '21:00',
  default_notes TEXT NOT NULL DEFAULT '',
  dm_reachable BOOLEAN NOT NULL DEFAULT FALSE,
  first_proposal_created_at TIMESTAMPTZ,
  first_application_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE line_groups (
  group_id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE proposals (
  management_id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES line_groups(group_id),
  proposer_line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  proposer_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_url TEXT,
  total_price INTEGER NOT NULL CHECK (total_price > 0),
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  host_wanted_count INTEGER NOT NULL CHECK (host_wanted_count > 0),
  deadline_at TIMESTAMPTZ NOT NULL,
  payment_id TEXT,
  payment_label TEXT NOT NULL DEFAULT 'PayPay',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('collecting', 'closed', 'ordered', 'completed', 'canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE applications (
  applicant_management_id TEXT PRIMARY KEY,
  management_id TEXT NOT NULL REFERENCES proposals(management_id),
  group_id TEXT,
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  display_name TEXT NOT NULL,
  wanted_count INTEGER NOT NULL CHECK (wanted_count > 0),
  status TEXT NOT NULL CHECK (status IN ('applied', 'canceled', 'ordered', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (management_id, line_user_id)
);

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  management_id TEXT NOT NULL REFERENCES proposals(management_id),
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('payment_requested', 'paid', 'canceled', 'refunded', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  payment_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  provider TEXT NOT NULL,
  provider_reference TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('requested', 'authorized', 'paid', 'failed', 'canceled', 'refunded')),
  instruction_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payment_events (
  event_id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(payment_id),
  provider TEXT NOT NULL,
  provider_reference TEXT,
  status TEXT NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  management_id TEXT REFERENCES proposals(management_id),
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'group', 'room', 'operator')),
  target_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'delivered', 'sent', 'failed', 'skipped')),
  error_message TEXT,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (management_id, type)
);

CREATE TABLE product_inference_cache (
  cache_key TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  item_url TEXT,
  shop_name TEXT,
  price INTEGER,
  item_count INTEGER,
  unit TEXT,
  confidence NUMERIC,
  source_layer TEXT NOT NULL,
  reason TEXT,
  auto_apply BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  audit_id TEXT PRIMARY KEY,
  actor_line_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE domain_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX applications_management_id_idx ON applications(management_id);
CREATE INDEX orders_management_id_idx ON orders(management_id);
CREATE INDEX payments_order_id_idx ON payments(order_id);
CREATE INDEX notifications_status_idx ON notifications(status);
CREATE INDEX domain_events_status_idx ON domain_events(status);
