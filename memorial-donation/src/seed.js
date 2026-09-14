/** 种子数据：默认管理员 + 示例分类/捐赠人/物品 */
const path = require('path');
const db = require('./db');
const { hashPassword } = require('./util');

async function main() {
  await db.init();

  // 默认管理员
  if (!db.get('SELECT id FROM admins WHERE username = ?', ['admin'])) {
    const { salt, hash } = hashPassword('admin123');
    db.run('INSERT INTO admins (username, password_hash, salt, display_name, role) VALUES (?,?,?,?,?)',
      ['admin', hash, salt, '系统管理员', 'admin']);
    console.log('创建默认管理员: admin / admin123');
  }

  // 示例分类
  const cats = [
    ['文献资料', '书信、日记、文件、报刊等纸质文献', 1],
    ['实物文物', '武器装备、生活用品、纪念章等实物', 2],
    ['照片影像', '历史照片、胶片、录像带等影像资料', 3],
    ['口述历史', '亲历者口述录音、访谈记录', 4],
  ];
  for (const [name, desc, sort] of cats) {
    if (!db.get('SELECT id FROM categories WHERE name = ?', [name])) {
      db.run('INSERT INTO categories (name, description, sort_order) VALUES (?,?,?)', [name, desc, sort]);
    }
  }

  // 示例捐赠人 + 物品（仅当没有任何物品时）
  if (db.get('SELECT COUNT(*) n FROM items').n === 0) {
    const { lastId: donorId } = db.run(
      'INSERT INTO donors (name, contact, address, notes) VALUES (?,?,?,?)',
      ['张建国', '138****0001', '本市城东街道', '抗战老兵后人，捐赠其父遗物']);
    const catId = db.get('SELECT id FROM categories WHERE name = ?', ['实物文物']).id;
    const { lastId: itemId } = db.run(`
      INSERT INTO items (code, name, donor_id, category_id, era, acquired_date, description, story,
        display_status, visibility, review_status, location, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      ['MJ-2025-0001', '军用搪瓷水杯', donorId, catId, '1940年代', '2025-03-12',
        '军绿色搪瓷水杯，杯身有五角星图案，杯底铸有厂标，边缘有磕碰痕迹。',
        '捐赠人张建国之父张树林于1943年入伍时配发的水杯，伴随其参加多次战役。杯身的磕碰痕迹系1944年冬一次突围战中留下。张树林生前一直珍藏此杯，家人现捐赠给纪念馆，希望让更多人铭记那段历史。',
        'exhibiting', 'public', 'approved', '一号展厅 A-03 展柜']);
    db.run(`UPDATE items SET reviewed_by=1, reviewed_at=datetime('now','localtime') WHERE id=?`, [itemId]);
    console.log('创建示例数据: 捐赠人张建国 + 物品「军用搪瓷水杯」(已公开)');
  }

  db.flushSave();
  console.log('种子数据完成');
}

main().catch((e) => { console.error(e); process.exit(1); });
