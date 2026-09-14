/**
 * 数据库层：sql.js (SQLite WASM) + 文件持久化
 * 启动时从 data/app.db 加载，写操作后防抖保存。
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');

let db = null;
let saveTimer = null;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',          -- admin | staff
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS donors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  address TEXT DEFAULT '',
  id_number TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                    -- 藏品编号
  name TEXT NOT NULL,
  donor_id INTEGER REFERENCES donors(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  era TEXT DEFAULT '',                          -- 年代，如 "1930年代"
  acquired_date TEXT DEFAULT '',                -- 捐赠日期
  description TEXT DEFAULT '',                  -- 物品描述
  story TEXT DEFAULT '',                        -- 背后故事
  display_status TEXT NOT NULL DEFAULT 'storage',   -- storage库房 exhibiting展出中 on_loan外借 restoring修复中
  visibility TEXT NOT NULL DEFAULT 'private',       -- private未公开 public已公开
  review_status TEXT NOT NULL DEFAULT 'pending',    -- pending待审核 approved已通过 rejected已驳回
  review_comment TEXT DEFAULT '',
  reviewed_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  location TEXT DEFAULT '',                     -- 存放/展出位置
  created_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_items_review ON items(review_status, visibility);
CREATE INDEX IF NOT EXISTS idx_items_donor ON items(donor_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);

CREATE TABLE IF NOT EXISTS item_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_images_item ON item_images(item_id);

CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  donor_name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending待处理 accepted已采纳 rejected已驳回
  admin_reply TEXT DEFAULT '',
  processed_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
    } catch (e) {
      console.error('[db] 保存失败:', e.message);
    }
  }, 300);
}

function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (db) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
  }
}

async function init() {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f),
  });
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
    console.log('[db] 已加载', DB_FILE);
  } else {
    db = new SQL.Database();
    console.log('[db] 新建数据库');
  }
  db.run(SCHEMA);
  scheduleSave();
  return api;
}

/** 查询多行 */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** 查询单行 */
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

/** 执行写操作，返回 lastInsertId */
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  const idRow = get('SELECT last_insert_rowid() AS id, changes() AS changes');
  scheduleSave();
  return { lastId: idRow.id, changes: idRow.changes };
}

function tx(fn) {
  db.run('BEGIN');
  try {
    const result = fn();
    db.run('COMMIT');
    scheduleSave();
    return result;
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
}

const api = { all, get, run, tx, flushSave };
module.exports = { init, ...api, get raw() { return db; } };
