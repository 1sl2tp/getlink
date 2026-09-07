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


CREATE TABLE IF NOT EXISTS product_variants(
  id TEXT PRIMARY KEY,
  parent_url TEXT NOT NULL,
  variant_url TEXT NOT NULL,
  bhx_product_id INTEGER,
  product_code TEXT,
  name TEXT,
  title TEXT,
  packaging TEXT,
  package_item_count REAL,
  package_item_unit TEXT,
  current_price INTEGER,
  sys_price INTEGER,
  discount_percent REAL,
  stock INTEGER,
  is_can_buy INTEGER,
  text_status TEXT,
  store_id INTEGER,
  po_date TEXT,
  image TEXT,
  raw_json TEXT,
  last_checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(parent_url,variant_url,product_code)
);

CREATE INDEX IF NOT EXISTS idx_variants_parent
ON product_variants(parent_url);

CREATE INDEX IF NOT EXISTS idx_variants_product_code
ON product_variants(product_code);

CREATE TABLE IF NOT EXISTS variant_price_snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  current_price INTEGER,
  sys_price INTEGER,
  discount_percent REAL,
  stock INTEGER,
  is_can_buy INTEGER,
  po_date TEXT,
  raw_json TEXT,
  UNIQUE(variant_id,request_id),
  FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_variant_snapshots_checked
ON variant_price_snapshots(variant_id,checked_at DESC);


CREATE TABLE IF NOT EXISTS daily_variant_prices(
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  parent_url TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  product_name TEXT,
  packaging TEXT,
  pack_quantity REAL NOT NULL DEFAULT 1,
  pack_unit TEXT,
  size_value REAL,
  size_unit TEXT,
  regular_pack_price INTEGER,
  promo_pack_price INTEGER,
  regular_unit_price REAL,
  promo_unit_price REAL,
  promotion_active INTEGER NOT NULL DEFAULT 0,
  promotion_text TEXT,
  checked_at TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(variant_id,snapshot_date),
  FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_variant_date
ON daily_variant_prices(snapshot_date DESC,variant_id);

CREATE INDEX IF NOT EXISTS idx_daily_variant_parent
ON daily_variant_prices(parent_url,snapshot_date DESC);
