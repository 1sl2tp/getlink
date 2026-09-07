PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS jobs(
  request_id TEXT PRIMARY KEY,
  input_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK(link_type IN ('category','product')),
  status TEXT NOT NULL DEFAULT 'queued',
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_updated
ON jobs(status,updated_at);

CREATE TABLE IF NOT EXISTS links(
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'Bách Hóa XANH',
  link_type TEXT NOT NULL CHECK(link_type IN ('category','product')),
  parent_url TEXT,
  group_name TEXT,
  branch_name TEXT,
  name TEXT,
  packaging TEXT,
  current_price INTEGER,
  original_price INTEGER,
  promotion_price INTEGER,
  promotion_text TEXT,
  my_price INTEGER,
  watch INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  last_checked_at TEXT,
  last_status TEXT,
  last_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_links_type_group
ON links(link_type,group_name,branch_name);

CREATE INDEX IF NOT EXISTS idx_links_parent
ON links(parent_url);

CREATE TABLE IF NOT EXISTS price_snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  current_price INTEGER,
  original_price INTEGER,
  promotion_price INTEGER,
  promotion_text TEXT,
  result_json TEXT,
  UNIQUE(link_id,request_id),
  FOREIGN KEY(link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_link_checked
ON price_snapshots(link_id,checked_at DESC);
