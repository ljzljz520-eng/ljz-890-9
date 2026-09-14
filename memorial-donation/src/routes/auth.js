const express = require('express');
const db = require('../db');
const { verifyPassword } = require('../util');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const admin = db.get('SELECT * FROM admins WHERE username = ?', [String(username).trim()]);
  if (!admin || !verifyPassword(password, admin.salt, admin.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.adminId = admin.id;
  req.session.role = admin.role;
  req.session.displayName = admin.display_name;
  res.json({ ok: true, user: { id: admin.id, username: admin.username, display_name: admin.display_name, role: admin.role } });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: '未登录' });
  const admin = db.get('SELECT id, username, display_name, role FROM admins WHERE id = ?', [req.session.adminId]);
  if (!admin) return res.status(401).json({ error: '账号不存在' });
  res.json({ user: admin });
});

module.exports = router;
