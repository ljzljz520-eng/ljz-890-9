/**
 * 公开前台 API —— 只返回「审核通过 + 已公开」的资料
 */
const express = require('express');
const db = require('../db');
const { str, intOr, requireFields } = require('../util');

const router = express.Router();

const PUBLIC_WHERE = "i.review_status = 'approved' AND i.visibility = 'public'";

// 公开分类（含各分类下公开物品数）
router.get('/categories', (req, res) => {
  const rows = db.all(`
    SELECT c.id, c.name, c.description,
      (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id AND ${PUBLIC_WHERE}) AS item_count
    FROM categories c ORDER BY c.sort_order, c.id`);
  res.json({ categories: rows });
});

// 公开物品列表：关键词 / 分类 / 年代筛选 + 分页
router.get('/items', (req, res) => {
  const keyword = str(req.query.keyword, 100);
  const categoryId = intOr(req.query.category_id);
  const era = str(req.query.era, 50);
  const page = Math.max(1, intOr(req.query.page, 1));
  const pageSize = Math.min(50, Math.max(1, intOr(req.query.page_size, 12)));

  const conds = [PUBLIC_WHERE];
  const params = [];
  if (keyword) {
    conds.push('(i.name LIKE ? OR i.description LIKE ? OR i.story LIKE ? OR i.code LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like, like);
  }
  if (categoryId) { conds.push('i.category_id = ?'); params.push(categoryId); }
  if (era) { conds.push('i.era LIKE ?'); params.push(`%${era}%`); }
  const where = conds.join(' AND ');

  const total = db.get(`SELECT COUNT(*) AS n FROM items i WHERE ${where}`, params).n;
  const items = db.all(`
    SELECT i.id, i.code, i.name, i.era, i.description, i.display_status, i.acquired_date,
           c.name AS category_name, d.name AS donor_name,
           (SELECT filename FROM item_images im WHERE im.item_id = i.id
            ORDER BY im.is_primary DESC, im.sort_order, im.id LIMIT 1) AS cover
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN donors d ON d.id = i.donor_id
    WHERE ${where}
    ORDER BY i.id DESC
    LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);

  const eras = db.all(`SELECT DISTINCT era FROM items i WHERE ${PUBLIC_WHERE} AND era != '' ORDER BY era`)
    .map((r) => r.era);

  res.json({ items, total, page, page_size: pageSize, eras });
});

// 公开物品详情
router.get('/items/:id', (req, res) => {
  const id = intOr(req.params.id);
  const item = db.get(`
    SELECT i.id, i.code, i.name, i.era, i.description, i.story, i.display_status,
           i.acquired_date, i.location, i.created_at,
           c.name AS category_name, d.name AS donor_name
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN donors d ON d.id = i.donor_id
    WHERE i.id = ? AND ${PUBLIC_WHERE}`, [id]);
  if (!item) return res.status(404).json({ error: '资料不存在或未公开' });
  const images = db.all(
    'SELECT id, filename, is_primary FROM item_images WHERE item_id = ? ORDER BY is_primary DESC, sort_order, id', [id]);
  res.json({ item, images });
});

// 捐赠人提交更正说明
const correctionLimiter = new Map(); // 简单 IP 限流：1分钟最多5条
router.post('/corrections', (req, res) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const hits = (correctionLimiter.get(ip) || []).filter((t) => now - t < 60000);
  if (hits.length >= 5) return res.status(429).json({ error: '提交过于频繁，请稍后再试' });
  hits.push(now);
  correctionLimiter.set(ip, hits);

  const body = req.body || {};
  const err = requireFields(body, ['item_id', 'donor_name', 'content']);
  if (err) return res.status(400).json({ error: err });

  const itemId = intOr(body.item_id);
  const item = db.get(`SELECT id FROM items i WHERE i.id = ? AND ${PUBLIC_WHERE}`, [itemId]);
  if (!item) return res.status(404).json({ error: '资料不存在或未公开' });

  const content = str(body.content, 2000);
  if (content.length < 5) return res.status(400).json({ error: '更正说明至少 5 个字' });

  const { lastId } = db.run(
    'INSERT INTO corrections (item_id, donor_name, contact, content) VALUES (?,?,?,?)',
    [itemId, str(body.donor_name, 50), str(body.contact, 100), content]);
  res.json({ ok: true, id: lastId, message: '更正申请已提交，工作人员核实后会处理' });
});

module.exports = router;
