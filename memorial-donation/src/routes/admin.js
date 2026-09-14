/**
 * 后台管理 API（全部需要登录）
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { str, intOr, requireFields, toCSV, hashPassword } = require('../util');

const router = express.Router();
router.use(requireAuth);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const DISPLAY_STATUSES = ['storage', 'exhibiting', 'on_loan', 'restoring'];
const VISIBILITIES = ['private', 'public'];

function logAction(itemId, adminId, action, detail = '') {
  db.run('INSERT INTO audit_logs (item_id, admin_id, action, detail) VALUES (?,?,?,?)',
    [itemId, adminId, action, str(detail, 500)]);
}

/* ============ 仪表盘统计 ============ */
router.get('/stats', (req, res) => {
  const one = (sql) => db.get(sql).n;
  res.json({
    items_total: one('SELECT COUNT(*) n FROM items'),
    items_pending: one("SELECT COUNT(*) n FROM items WHERE review_status='pending'"),
    items_public: one("SELECT COUNT(*) n FROM items WHERE review_status='approved' AND visibility='public'"),
    donors: one('SELECT COUNT(*) n FROM donors'),
    categories: one('SELECT COUNT(*) n FROM categories'),
    images: one('SELECT COUNT(*) n FROM item_images'),
    corrections_pending: one("SELECT COUNT(*) n FROM corrections WHERE status='pending'"),
    recent_logs: db.all(`
      SELECT l.*, a.display_name AS admin_name, i.name AS item_name
      FROM audit_logs l LEFT JOIN admins a ON a.id=l.admin_id LEFT JOIN items i ON i.id=l.item_id
      ORDER BY l.id DESC LIMIT 10`),
  });
});

/* ============ 捐赠人管理 ============ */
router.get('/donors', (req, res) => {
  const keyword = str(req.query.keyword, 100);
  let sql = `SELECT d.*, (SELECT COUNT(*) FROM items i WHERE i.donor_id = d.id) AS item_count
             FROM donors d`;
  const params = [];
  if (keyword) { sql += ' WHERE d.name LIKE ? OR d.contact LIKE ?'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY d.id DESC';
  res.json({ donors: db.all(sql, params) });
});

router.post('/donors', (req, res) => {
  const b = req.body || {};
  const err = requireFields(b, ['name']);
  if (err) return res.status(400).json({ error: err });
  const { lastId } = db.run(
    'INSERT INTO donors (name, contact, address, id_number, notes) VALUES (?,?,?,?,?)',
    [str(b.name, 50), str(b.contact, 100), str(b.address, 200), str(b.id_number, 50), str(b.notes, 1000)]);
  res.json({ ok: true, id: lastId });
});

router.get('/donors/:id', (req, res) => {
  const donor = db.get('SELECT * FROM donors WHERE id = ?', [intOr(req.params.id)]);
  if (!donor) return res.status(404).json({ error: '捐赠人不存在' });
  donor.items = db.all('SELECT id, code, name, era, review_status, visibility FROM items WHERE donor_id = ? ORDER BY id DESC', [donor.id]);
  res.json({ donor });
});

router.put('/donors/:id', (req, res) => {
  const id = intOr(req.params.id);
  if (!db.get('SELECT id FROM donors WHERE id = ?', [id])) return res.status(404).json({ error: '捐赠人不存在' });
  const b = req.body || {};
  const err = requireFields(b, ['name']);
  if (err) return res.status(400).json({ error: err });
  db.run(`UPDATE donors SET name=?, contact=?, address=?, id_number=?, notes=?,
          updated_at=datetime('now','localtime') WHERE id=?`,
    [str(b.name, 50), str(b.contact, 100), str(b.address, 200), str(b.id_number, 50), str(b.notes, 1000), id]);
  res.json({ ok: true });
});

router.delete('/donors/:id', (req, res) => {
  const id = intOr(req.params.id);
  const cnt = db.get('SELECT COUNT(*) n FROM items WHERE donor_id = ?', [id]).n;
  if (cnt > 0) return res.status(400).json({ error: `该捐赠人名下还有 ${cnt} 件物品，无法删除` });
  db.run('DELETE FROM donors WHERE id = ?', [id]);
  res.json({ ok: true });
});

/* ============ 分类管理 ============ */
router.get('/categories', (req, res) => {
  res.json({
    categories: db.all(`
      SELECT c.*, (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS item_count
      FROM categories c ORDER BY c.sort_order, c.id`),
  });
});

router.post('/categories', (req, res) => {
  const b = req.body || {};
  const err = requireFields(b, ['name']);
  if (err) return res.status(400).json({ error: err });
  try {
    const { lastId } = db.run('INSERT INTO categories (name, description, sort_order) VALUES (?,?,?)',
      [str(b.name, 50), str(b.description, 500), intOr(b.sort_order, 0)]);
    res.json({ ok: true, id: lastId });
  } catch (e) {
    res.status(400).json({ error: '分类名称已存在' });
  }
});

router.put('/categories/:id', (req, res) => {
  const id = intOr(req.params.id);
  if (!db.get('SELECT id FROM categories WHERE id = ?', [id])) return res.status(404).json({ error: '分类不存在' });
  const b = req.body || {};
  try {
    db.run('UPDATE categories SET name=?, description=?, sort_order=? WHERE id=?',
      [str(b.name, 50), str(b.description, 500), intOr(b.sort_order, 0), id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: '分类名称已存在' });
  }
});

router.delete('/categories/:id', (req, res) => {
  const id = intOr(req.params.id);
  const cnt = db.get('SELECT COUNT(*) n FROM items WHERE category_id = ?', [id]).n;
  if (cnt > 0) return res.status(400).json({ error: `该分类下还有 ${cnt} 件物品，无法删除` });
  db.run('DELETE FROM categories WHERE id = ?', [id]);
  res.json({ ok: true });
});

/* ============ 物品管理 ============ */
const ITEM_SELECT = `
  SELECT i.*, d.name AS donor_name, c.name AS category_name, a.display_name AS creator_name,
    (SELECT COUNT(*) FROM item_images im WHERE im.item_id = i.id) AS image_count,
    (SELECT filename FROM item_images im WHERE im.item_id = i.id
     ORDER BY im.is_primary DESC, im.sort_order, im.id LIMIT 1) AS cover
  FROM items i
  LEFT JOIN donors d ON d.id = i.donor_id
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN admins a ON a.id = i.created_by`;

router.get('/items', (req, res) => {
  const conds = ['1=1'];
  const params = [];
  const keyword = str(req.query.keyword, 100);
  if (keyword) {
    conds.push('(i.name LIKE ? OR i.code LIKE ? OR i.description LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  for (const [q, col] of [['review_status', 'i.review_status'], ['visibility', 'i.visibility'], ['display_status', 'i.display_status']]) {
    const v = str(req.query[q], 20);
    if (v) { conds.push(`${col} = ?`); params.push(v); }
  }
  const categoryId = intOr(req.query.category_id);
  if (categoryId) { conds.push('i.category_id = ?'); params.push(categoryId); }
  const donorId = intOr(req.query.donor_id);
  if (donorId) { conds.push('i.donor_id = ?'); params.push(donorId); }

  const page = Math.max(1, intOr(req.query.page, 1));
  const pageSize = Math.min(100, Math.max(1, intOr(req.query.page_size, 20)));
  const where = conds.join(' AND ');
  const total = db.get(`SELECT COUNT(*) n FROM items i WHERE ${where}`, params).n;
  const items = db.all(`${ITEM_SELECT} WHERE ${where} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]);
  res.json({ items, total, page, page_size: pageSize });
});

function validateItemBody(b) {
  const err = requireFields(b, ['name', 'code']);
  if (err) return err;
  if (b.display_status && !DISPLAY_STATUSES.includes(b.display_status)) return '展示状态不合法';
  if (b.visibility && !VISIBILITIES.includes(b.visibility)) return '公开状态不合法';
  return null;
}

router.post('/items', (req, res) => {
  const b = req.body || {};
  const err = validateItemBody(b);
  if (err) return res.status(400).json({ error: err });
  if (db.get('SELECT id FROM items WHERE code = ?', [str(b.code, 50)])) {
    return res.status(400).json({ error: '藏品编号已存在' });
  }
  const { lastId } = db.run(`
    INSERT INTO items (code, name, donor_id, category_id, era, acquired_date, description, story,
                       display_status, visibility, location, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [str(b.code, 50), str(b.name, 100), intOr(b.donor_id), intOr(b.category_id), str(b.era, 50),
     str(b.acquired_date, 20), str(b.description, 5000), str(b.story, 10000),
     b.display_status || 'storage', b.visibility || 'private', str(b.location, 100), req.session.adminId]);
  logAction(lastId, req.session.adminId, 'create', `登记物品「${str(b.name, 100)}」`);
  res.json({ ok: true, id: lastId });
});

router.get('/items/:id', (req, res) => {
  const id = intOr(req.params.id);
  const item = db.get(`${ITEM_SELECT} WHERE i.id = ?`, [id]);
  if (!item) return res.status(404).json({ error: '物品不存在' });
  item.images = db.all('SELECT * FROM item_images WHERE item_id = ? ORDER BY is_primary DESC, sort_order, id', [id]);
  item.corrections = db.all(`
    SELECT co.*, a.display_name AS processor_name FROM corrections co
    LEFT JOIN admins a ON a.id = co.processed_by
    WHERE co.item_id = ? ORDER BY co.id DESC`, [id]);
  item.logs = db.all(`
    SELECT l.*, a.display_name AS admin_name FROM audit_logs l
    LEFT JOIN admins a ON a.id = l.admin_id WHERE l.item_id = ? ORDER BY l.id DESC LIMIT 20`, [id]);
  res.json({ item });
});

router.put('/items/:id', (req, res) => {
  const id = intOr(req.params.id);
  const old = db.get('SELECT * FROM items WHERE id = ?', [id]);
  if (!old) return res.status(404).json({ error: '物品不存在' });
  const b = req.body || {};
  const err = validateItemBody(b);
  if (err) return res.status(400).json({ error: err });
  const dup = db.get('SELECT id FROM items WHERE code = ? AND id != ?', [str(b.code, 50), id]);
  if (dup) return res.status(400).json({ error: '藏品编号已存在' });
  db.run(`
    UPDATE items SET code=?, name=?, donor_id=?, category_id=?, era=?, acquired_date=?,
      description=?, story=?, display_status=?, visibility=?, location=?,
      updated_at=datetime('now','localtime')
    WHERE id=?`,
    [str(b.code, 50), str(b.name, 100), intOr(b.donor_id), intOr(b.category_id), str(b.era, 50),
     str(b.acquired_date, 20), str(b.description, 5000), str(b.story, 10000),
     b.display_status || 'storage', b.visibility || 'private', str(b.location, 100), id]);
  logAction(id, req.session.adminId, 'update', '修改物品资料');
  res.json({ ok: true });
});

router.delete('/items/:id', (req, res) => {
  const id = intOr(req.params.id);
  const item = db.get('SELECT * FROM items WHERE id = ?', [id]);
  if (!item) return res.status(404).json({ error: '物品不存在' });
  const images = db.all('SELECT filename FROM item_images WHERE item_id = ?', [id]);
  db.tx(() => {
    db.run('DELETE FROM item_images WHERE item_id = ?', [id]);
    db.run('DELETE FROM corrections WHERE item_id = ?', [id]);
    db.run('DELETE FROM items WHERE id = ?', [id]);
  });
  for (const img of images) {
    fs.promises.unlink(path.join(UPLOAD_DIR, img.filename)).catch(() => {});
  }
  logAction(id, req.session.adminId, 'delete', `删除物品「${item.name}」(${item.code})`);
  res.json({ ok: true });
});

/* ---- 审核 ---- */
router.post('/items/:id/review', (req, res) => {
  const id = intOr(req.params.id);
  const item = db.get('SELECT * FROM items WHERE id = ?', [id]);
  if (!item) return res.status(404).json({ error: '物品不存在' });
  const { action, comment, visibility } = req.body || {};
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action 必须为 approve 或 reject' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  let vis = item.visibility;
  if (action === 'approve' && VISIBILITIES.includes(visibility)) vis = visibility;
  if (action === 'reject') vis = 'private'; // 驳回一律不公开

  db.run(`UPDATE items SET review_status=?, review_comment=?, visibility=?,
          reviewed_by=?, reviewed_at=datetime('now','localtime'),
          updated_at=datetime('now','localtime') WHERE id=?`,
    [status, str(comment, 500), vis, req.session.adminId, id]);
  logAction(id, req.session.adminId, action === 'approve' ? 'approve' : 'reject',
    `${action === 'approve' ? '审核通过' : '审核驳回'}${comment ? '：' + str(comment, 200) : ''}`);
  res.json({ ok: true, review_status: status, visibility: vis });
});

/* ---- 公开状态切换 ---- */
router.put('/items/:id/visibility', (req, res) => {
  const id = intOr(req.params.id);
  const item = db.get('SELECT * FROM items WHERE id = ?', [id]);
  if (!item) return res.status(404).json({ error: '物品不存在' });
  const { visibility } = req.body || {};
  if (!VISIBILITIES.includes(visibility)) return res.status(400).json({ error: '公开状态不合法' });
  if (visibility === 'public' && item.review_status !== 'approved') {
    return res.status(400).json({ error: '未审核通过的资料不能公开' });
  }
  db.run("UPDATE items SET visibility=?, updated_at=datetime('now','localtime') WHERE id=?", [visibility, id]);
  logAction(id, req.session.adminId, 'visibility', visibility === 'public' ? '设为公开' : '设为不公开');
  res.json({ ok: true });
});

/* ---- 图片管理 ---- */
const ALLOWED_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME[file.mimetype] || '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) cb(null, true);
    else cb(new Error('仅支持 JPG/PNG/GIF/WebP 图片'));
  },
});

router.post('/items/:id/images', (req, res) => {
  const id = intOr(req.params.id);
  if (!db.get('SELECT id FROM items WHERE id = ?', [id])) return res.status(404).json({ error: '物品不存在' });
  upload.array('images', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message === 'File too large' ? '图片不能超过 5MB' : err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: '未接收到图片' });
    const hasPrimary = db.get('SELECT id FROM item_images WHERE item_id = ? AND is_primary = 1', [id]);
    const maxSort = db.get('SELECT COALESCE(MAX(sort_order),0) m FROM item_images WHERE item_id = ?', [id]).m;
    const inserted = [];
    db.tx(() => {
      req.files.forEach((f, idx) => {
        const { lastId } = db.run(
          'INSERT INTO item_images (item_id, filename, original_name, mime, size, is_primary, sort_order) VALUES (?,?,?,?,?,?,?)',
          [id, f.filename, str(f.originalname, 200), f.mimetype, f.size, (!hasPrimary && idx === 0) ? 1 : 0, maxSort + idx + 1]);
        inserted.push({ id: lastId, filename: f.filename });
      });
    });
    logAction(id, req.session.adminId, 'upload', `上传 ${req.files.length} 张图片`);
    res.json({ ok: true, images: inserted });
  });
});

router.delete('/images/:id', (req, res) => {
  const id = intOr(req.params.id);
  const img = db.get('SELECT * FROM item_images WHERE id = ?', [id]);
  if (!img) return res.status(404).json({ error: '图片不存在' });
  db.tx(() => {
    db.run('DELETE FROM item_images WHERE id = ?', [id]);
    if (img.is_primary) {
      const next = db.get('SELECT id FROM item_images WHERE item_id = ? ORDER BY sort_order, id LIMIT 1', [img.item_id]);
      if (next) db.run('UPDATE item_images SET is_primary = 1 WHERE id = ?', [next.id]);
    }
  });
  fs.promises.unlink(path.join(UPLOAD_DIR, img.filename)).catch(() => {});
  res.json({ ok: true });
});

router.put('/images/:id/primary', (req, res) => {
  const id = intOr(req.params.id);
  const img = db.get('SELECT * FROM item_images WHERE id = ?', [id]);
  if (!img) return res.status(404).json({ error: '图片不存在' });
  db.tx(() => {
    db.run('UPDATE item_images SET is_primary = 0 WHERE item_id = ?', [img.item_id]);
    db.run('UPDATE item_images SET is_primary = 1 WHERE id = ?', [id]);
  });
  res.json({ ok: true });
});

router.put('/images/:id/sort', (req, res) => {
  const id = intOr(req.params.id);
  const order = intOr((req.body || {}).sort_order);
  if (order === null) return res.status(400).json({ error: 'sort_order 不合法' });
  db.run('UPDATE item_images SET sort_order = ? WHERE id = ?', [order, id]);
  res.json({ ok: true });
});

/* ============ 更正申请处理 ============ */
router.get('/corrections', (req, res) => {
  const status = str(req.query.status, 20);
  let sql = `
    SELECT co.*, i.name AS item_name, i.code AS item_code, a.display_name AS processor_name
    FROM corrections co
    JOIN items i ON i.id = co.item_id
    LEFT JOIN admins a ON a.id = co.processed_by`;
  const params = [];
  if (status) { sql += ' WHERE co.status = ?'; params.push(status); }
  sql += ' ORDER BY CASE co.status WHEN \'pending\' THEN 0 ELSE 1 END, co.id DESC';
  res.json({ corrections: db.all(sql, params) });
});

router.post('/corrections/:id/process', (req, res) => {
  const id = intOr(req.params.id);
  const correction = db.get('SELECT * FROM corrections WHERE id = ?', [id]);
  if (!correction) return res.status(404).json({ error: '更正申请不存在' });
  if (correction.status !== 'pending') return res.status(400).json({ error: '该申请已处理过' });
  const { action, reply } = req.body || {};
  if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'action 必须为 accept 或 reject' });
  const status = action === 'accept' ? 'accepted' : 'rejected';
  db.run(`UPDATE corrections SET status=?, admin_reply=?, processed_by=?, processed_at=datetime('now','localtime') WHERE id=?`,
    [status, str(reply, 1000), req.session.adminId, id]);
  logAction(correction.item_id, req.session.adminId, 'correction',
    `${action === 'accept' ? '采纳' : '驳回'}更正申请 #${id}`);
  res.json({ ok: true, status });
});

/* ============ 资料导出 (CSV) ============ */
const STATUS_CN = {
  review: { pending: '待审核', approved: '审核通过', rejected: '已驳回' },
  vis: { private: '未公开', public: '已公开' },
  display: { storage: '库房保存', exhibiting: '展出中', on_loan: '外借中', restoring: '修复中' },
  correction: { pending: '待处理', accepted: '已采纳', rejected: '已驳回' },
};

function sendCSV(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv);
}

router.get('/export/items', (req, res) => {
  const rows = db.all(`
    SELECT i.code, i.name, c.name AS category, d.name AS donor, i.era, i.acquired_date,
           i.display_status, i.visibility, i.review_status, i.location, i.description, i.story,
           i.review_comment, i.created_at, i.updated_at,
           (SELECT COUNT(*) FROM item_images im WHERE im.item_id=i.id) AS images
    FROM items i LEFT JOIN categories c ON c.id=i.category_id LEFT JOIN donors d ON d.id=i.donor_id
    ORDER BY i.id`);
  const csv = toCSV(
    ['藏品编号', '名称', '分类', '捐赠人', '年代', '捐赠日期', '展示状态', '公开状态', '审核状态',
     '存放位置', '图片数', '物品描述', '背后故事', '审核意见', '登记时间', '更新时间'],
    rows.map((r) => [r.code, r.name, r.category, r.donor, r.era, r.acquired_date,
      STATUS_CN.display[r.display_status], STATUS_CN.vis[r.visibility], STATUS_CN.review[r.review_status],
      r.location, r.images, r.description, r.story, r.review_comment, r.created_at, r.updated_at]));
  sendCSV(res, `捐赠物品_${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

router.get('/export/donors', (req, res) => {
  const rows = db.all(`
    SELECT d.*, (SELECT COUNT(*) FROM items i WHERE i.donor_id=d.id) AS items FROM donors d ORDER BY d.id`);
  const csv = toCSV(['姓名', '联系方式', '地址', '证件号', '捐赠物品数', '备注', '登记时间'],
    rows.map((r) => [r.name, r.contact, r.address, r.id_number, r.items, r.notes, r.created_at]));
  sendCSV(res, `捐赠人_${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

router.get('/export/corrections', (req, res) => {
  const rows = db.all(`
    SELECT co.*, i.name AS item_name, i.code AS item_code, a.display_name AS processor
    FROM corrections co JOIN items i ON i.id=co.item_id LEFT JOIN admins a ON a.id=co.processed_by
    ORDER BY co.id`);
  const csv = toCSV(['编号', '藏品编号', '物品名称', '提交人', '联系方式', '更正说明', '状态', '处理回复', '处理人', '提交时间', '处理时间'],
    rows.map((r) => [r.id, r.item_code, r.item_name, r.donor_name, r.contact, r.content,
      STATUS_CN.correction[r.status], r.admin_reply, r.processor, r.created_at, r.processed_at]));
  sendCSV(res, `更正申请_${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

/* ============ 账号管理（仅管理员） ============ */
router.get('/admins', requireAdmin, (req, res) => {
  res.json({ admins: db.all('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id') });
});

router.post('/admins', requireAdmin, (req, res) => {
  const b = req.body || {};
  const err = requireFields(b, ['username', 'password', 'display_name']);
  if (err) return res.status(400).json({ error: err });
  if (String(b.password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (db.get('SELECT id FROM admins WHERE username = ?', [str(b.username, 50)])) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  const { salt, hash } = hashPassword(b.password);
  const { lastId } = db.run('INSERT INTO admins (username, password_hash, salt, display_name, role) VALUES (?,?,?,?,?)',
    [str(b.username, 50), hash, salt, str(b.display_name, 50), b.role === 'admin' ? 'admin' : 'staff']);
  res.json({ ok: true, id: lastId });
});

router.put('/admins/:id/password', requireAuth, (req, res) => {
  const id = intOr(req.params.id);
  // 只能改自己的密码，管理员可以改任何人的
  if (req.session.adminId !== id && req.session.role !== 'admin') {
    return res.status(403).json({ error: '无权修改他人密码' });
  }
  const admin = db.get('SELECT * FROM admins WHERE id = ?', [id]);
  if (!admin) return res.status(404).json({ error: '账号不存在' });
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const { salt, hash } = hashPassword(password);
  db.run('UPDATE admins SET password_hash=?, salt=? WHERE id=?', [hash, salt, id]);
  res.json({ ok: true });
});

module.exports = router;
