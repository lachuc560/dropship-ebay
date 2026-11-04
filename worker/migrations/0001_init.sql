-- Schema khởi tạo theo mục 5 của plan. Phase 0 chỉ tạo khung; các bảng được dùng dần ở các phase sau.

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'seller' CHECK (role IN ('admin', 'seller')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL CHECK (source IN ('amazon', 'walmart', 'ebay')),
  source_url  TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  title_raw   TEXT,
  price_raw   REAL,
  currency    TEXT,
  raw_json    TEXT,
  status      TEXT NOT NULL DEFAULT 'crawled'
              CHECK (status IN ('crawled','images_ready','ai_done','approved','filled','listed','error')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  r2_key      TEXT NOT NULL,
  url         TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER
);

CREATE TABLE IF NOT EXISTS drafts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku              TEXT NOT NULL UNIQUE,
  title            TEXT,
  category_id      TEXT,
  item_specifics   TEXT,            -- JSON
  condition        TEXT DEFAULT 'New',
  description_html TEXT,
  price            REAL,
  quantity         INTEGER DEFAULT 1,
  ai_cost          REAL,
  approved_by      INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ebay_listings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id     INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  ebay_account TEXT,
  item_id      TEXT UNIQUE,
  listed_by    INTEGER REFERENCES users(id),
  listed_at    TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS category_templates (
  category_id        TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  required_specifics TEXT NOT NULL   -- JSON array
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  step       TEXT NOT NULL,
  status     TEXT NOT NULL,
  message    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
