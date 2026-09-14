const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./src/db');

const PORT = process.env.PORT || 3000;

async function main() {
  await db.init();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(session({
    secret: process.env.SESSION_SECRET || 'memorial-donation-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }, // 8小时
  }));

  // API 路由
  app.use('/api/auth', require('./src/routes/auth'));
  app.use('/api/public', require('./src/routes/public'));
  app.use('/api/admin', require('./src/routes/admin'));

  // 静态资源
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // API 404
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

  // 错误处理
  app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
  });

  const server = app.listen(PORT, () => {
    console.log(`纪念馆捐赠资料管理系统已启动: http://localhost:${PORT}`);
    console.log(`  前台展厅: http://localhost:${PORT}/`);
    console.log(`  管理后台: http://localhost:${PORT}/admin/`);
  });

  const shutdown = () => {
    console.log('\n正在保存数据库并退出...');
    server.close(() => { db.flushSave(); process.exit(0); });
    setTimeout(() => { db.flushSave(); process.exit(0); }, 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error('启动失败:', e); process.exit(1); });
