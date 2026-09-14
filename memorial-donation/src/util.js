const crypto = require('crypto');

/** scrypt 密码哈希 */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const { hash: h } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
}

/** CSV 导出（带 BOM，Excel 中文兼容） */
function toCSV(headers, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) v = '';
    v = String(v);
    if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  };
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return '﻿' + lines.join('\r\n');
}

/** 简单字段校验 */
function requireFields(body, fields) {
  const missing = fields.filter((f) => !body[f] || !String(body[f]).trim());
  return missing.length ? `缺少必填字段: ${missing.join(', ')}` : null;
}

function str(v, max = 5000) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function intOr(v, dft = null) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dft : n;
}

module.exports = { hashPassword, verifyPassword, toCSV, requireFields, str, intOr };
