/** 登录态中间件 */
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: '未登录或会话已过期' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId && req.session.role === 'admin') return next();
  return res.status(403).json({ error: '需要管理员权限' });
}

module.exports = { requireAuth, requireAdmin };
