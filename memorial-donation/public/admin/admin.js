/* ================= 基础工具 ================= */
const $ = (sel) => document.querySelector(sel);
const main = $('#main');

const REVIEW_CN = { pending: '待审核', approved: '审核通过', rejected: '已驳回' };
const VIS_CN = { private: '未公开', public: '已公开' };
const DISPLAY_CN = { storage: '库房保存', exhibiting: '展出中', on_loan: '外借中', restoring: '修复中' };
const CORR_CN = { pending: '待处理', accepted: '已采纳', rejected: '已驳回' };
const reviewTag = (s) => `<span class="tag ${s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'orange'}">${REVIEW_CN[s]}</span>`;
const visTag = (s) => `<span class="tag ${s === 'public' ? 'green' : 'gray'}">${VIS_CN[s]}</span>`;
const corrTag = (s) => `<span class="tag ${s === 'accepted' ? 'green' : s === 'rejected' ? 'red' : 'orange'}">${CORR_CN[s]}</span>`;

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.background = ok ? '#2e7d4f' : '#b03a2e';
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 2400);
}
async function api(path, opts = {}) {
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  if (res.status === 401) { location.href = '/admin/login.html'; throw new Error('未登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}
function openModal(html, wide = false) {
  $('#modalBox').className = wide ? 'modal wide' : 'modal';
  $('#modalBox').innerHTML = html;
  $('#modalMask').classList.add('show');
}
function closeModal() { $('#modalMask').classList.remove('show'); }
$('#modalMask').addEventListener('click', (e) => { if (e.target.id === 'modalMask') closeModal(); });

/* ================= 启动与导航 ================= */
let currentUser = null;
let metaCache = { donors: [], categories: [] };

async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    currentUser = user;
  } catch { return; }
  $('#userName').textContent = user.display_name;
  $('#userRole').textContent = user.role === 'admin' ? '管理员' : '工作人员';
  if (user.role === 'admin') $('#navAdmins').style.display = 'block';
  document.querySelectorAll('#nav a').forEach((a) => {
    a.onclick = () => {
      document.querySelectorAll('#nav a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      go(a.dataset.page);
    };
  });
  refreshBadges();
  go('dashboard');
}
async function refreshBadges() {
  try {
    const s = await api('/api/admin/stats');
    const bp = $('#badgePending'), bc = $('#badgeCorr');
    bp.style.display = s.items_pending ? 'inline-block' : 'none';
    bp.textContent = s.items_pending;
    bc.style.display = s.corrections_pending ? 'inline-block' : 'none';
    bc.textContent = s.corrections_pending;
  } catch {}
}
function go(page) {
  ({ dashboard: pageDashboard, items: pageItems, review: pageReview, corrections: pageCorrections,
     donors: pageDonors, categories: pageCategories, export: pageExport, admins: pageAdmins }[page] || pageDashboard)();
}
async function loadMeta() {
  const [d, c] = await Promise.all([api('/api/admin/donors'), api('/api/admin/categories')]);
  metaCache = { donors: d.donors, categories: c.categories };
}
async function logout() { await api('/api/auth/logout', { method: 'POST' }); location.href = '/admin/login.html'; }
function openPwdModal() {
  openModal(`<h3>修改密码</h3>
    <div class="field"><label>新密码（至少 6 位）</label><input type="password" id="pwd1"></div>
    <div class="field"><label>确认新密码</label><input type="password" id="pwd2"></div>
    <div class="actions"><button class="btn gray" onclick="closeModal()">取消</button>
    <button class="btn" onclick="submitPwd()">保存</button></div>`);
}
async function submitPwd() {
  const p1 = $('#pwd1').value, p2 = $('#pwd2').value;
  if (p1.length < 6) return toast('密码至少 6 位', false);
  if (p1 !== p2) return toast('两次输入不一致', false);
  try {
    await api(`/api/admin/admins/${currentUser.id}/password`, { method: 'PUT', body: { password: p1 } });
    closeModal(); toast('密码已修改');
  } catch (e) { toast(e.message, false); }
}

/* ================= 工作台 ================= */
async function pageDashboard() {
  const s = await api('/api/admin/stats');
  main.innerHTML = `
    <div class="page-title">工作台</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${s.items_total}</div><div class="lbl">登记物品总数</div></div>
      <div class="stat-card"><div class="num" style="color:var(--orange)">${s.items_pending}</div><div class="lbl">待审核</div></div>
      <div class="stat-card"><div class="num" style="color:var(--green)">${s.items_public}</div><div class="lbl">已公开展示</div></div>
      <div class="stat-card"><div class="num">${s.donors}</div><div class="lbl">捐赠人</div></div>
      <div class="stat-card"><div class="num">${s.images}</div><div class="lbl">资料图片</div></div>
      <div class="stat-card"><div class="num" style="color:var(--red)">${s.corrections_pending}</div><div class="lbl">待处理更正</div></div>
    </div>
    <div class="panel">
      <h3 style="margin-bottom:12px">最近操作记录</h3>
      <ul class="log-list">${s.recent_logs.length ? s.recent_logs.map((l) =>
        `<li><b>${esc(l.admin_name || '系统')}</b> ${esc(l.detail || l.action)}
         ${l.item_name ? `（${esc(l.item_name)}）` : ''} <span style="color:#b8ad9c;float:right">${l.created_at}</span></li>`).join('')
        : '<li>暂无记录</li>'}</ul>
    </div>`;
}

/* ================= 物品资料 ================= */
let itemQuery = { page: 1, keyword: '', review_status: '', visibility: '', category_id: '' };

async function pageItems() {
  await loadMeta();
  main.innerHTML = `
    <div class="page-title">物品资料
      <button class="btn" onclick="openItemModal()">＋ 登记物品</button></div>
    <div class="panel">
      <div class="toolbar">
        <input id="qKw" placeholder="名称 / 编号 / 描述" value="${esc(itemQuery.keyword)}" style="width:200px">
        <select id="qReview"><option value="">全部审核状态</option>
          ${Object.entries(REVIEW_CN).map(([k, v]) => `<option value="${k}" ${itemQuery.review_status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select id="qVis"><option value="">全部公开状态</option>
          ${Object.entries(VIS_CN).map(([k, v]) => `<option value="${k}" ${itemQuery.visibility === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select id="qCat"><option value="">全部分类</option>
          ${metaCache.categories.map((c) => `<option value="${c.id}" ${itemQuery.category_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <button class="btn small" onclick="searchItems()">查询</button>
      </div>
      <div id="itemTable"></div>
      <div id="itemPager" class="pager"></div>
    </div>`;
  $('#qKw').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchItems(); });
  await loadItems();
}
function searchItems() {
  itemQuery = { page: 1, keyword: $('#qKw').value.trim(), review_status: $('#qReview').value,
    visibility: $('#qVis').value, category_id: $('#qCat').value };
  loadItems();
}
async function loadItems() {
  const q = new URLSearchParams({ page: itemQuery.page, page_size: 15 });
  for (const k of ['keyword', 'review_status', 'visibility', 'category_id']) if (itemQuery[k]) q.set(k, itemQuery[k]);
  const data = await api('/api/admin/items?' + q);
  $('#itemTable').innerHTML = `<table class="tbl"><thead><tr>
      <th>编号</th><th>名称</th><th>分类</th><th>捐赠人</th><th>年代</th><th>图</th><th>审核</th><th>公开</th><th>展示状态</th><th>操作</th>
    </tr></thead><tbody>${data.items.map((it) => `<tr>
      <td>${esc(it.code)}</td>
      <td><b>${esc(it.name)}</b></td>
      <td>${esc(it.category_name || '—')}</td>
      <td>${esc(it.donor_name || '—')}</td>
      <td>${esc(it.era || '—')}</td>
      <td>${it.image_count}</td>
      <td>${reviewTag(it.review_status)}</td>
      <td>${visTag(it.visibility)}</td>
      <td><span class="tag">${DISPLAY_CN[it.display_status]}</span></td>
      <td class="ops">
        <a onclick="openItemModal(${it.id})">编辑</a>
        <a onclick="openImageModal(${it.id}, '${esc(it.name)}')">图片</a>
        <a onclick="openReviewModal(${it.id}, '${esc(it.name)}')">审核</a>
        ${it.review_status === 'approved'
          ? `<a onclick="toggleVis(${it.id}, '${it.visibility === 'public' ? 'private' : 'public'}')">${it.visibility === 'public' ? '下架' : '公开'}</a>` : ''}
        <a class="danger" onclick="delItem(${it.id}, '${esc(it.name)}')">删除</a>
      </td></tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:#999;padding:30px">暂无数据</td></tr>'}
    </tbody></table>`;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  $('#itemPager').innerHTML = `
    <button ${itemQuery.page <= 1 ? 'disabled' : ''} onclick="itemQuery.page--;loadItems()">上一页</button>
    <span>第 ${itemQuery.page} / ${pages} 页 · 共 ${data.total} 件</span>
    <button ${itemQuery.page >= pages ? 'disabled' : ''} onclick="itemQuery.page++;loadItems()">下一页</button>`;
}

async function openItemModal(id) {
  await loadMeta();
  let it = { code: '', name: '', donor_id: '', category_id: '', era: '', acquired_date: '',
    description: '', story: '', display_status: 'storage', visibility: 'private', location: '' };
  if (id) it = (await api('/api/admin/items/' + id)).item;
  const opt = (list, val) => `<option value="">— 请选择 —</option>` +
    list.map((x) => `<option value="${x.id}" ${val == x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  openModal(`<h3>${id ? '编辑物品资料' : '登记物品'}</h3>
    <div class="form-row">
      <div class="field"><label>藏品编号 <span class="req">*</span></label><input id="fCode" value="${esc(it.code)}" placeholder="如 MJ-2026-0001"></div>
      <div class="field"><label>物品名称 <span class="req">*</span></label><input id="fName" value="${esc(it.name)}"></div>
      <div class="field"><label>捐赠人</label><select id="fDonor">${opt(metaCache.donors, it.donor_id)}</select></div>
      <div class="field"><label>分类</label><select id="fCat">${opt(metaCache.categories, it.category_id)}</select></div>
      <div class="field"><label>年代</label><input id="fEra" value="${esc(it.era)}" placeholder="如 1940年代"></div>
      <div class="field"><label>捐赠日期</label><input id="fDate" type="date" value="${esc(it.acquired_date)}"></div>
      <div class="field"><label>展示状态</label><select id="fDisplay">
        ${Object.entries(DISPLAY_CN).map(([k, v]) => `<option value="${k}" ${it.display_status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>公开状态</label><select id="fVis">
        ${Object.entries(VIS_CN).map(([k, v]) => `<option value="${k}" ${it.visibility === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field" style="grid-column:1/-1"><label>存放 / 展出位置</label><input id="fLoc" value="${esc(it.location)}" placeholder="如 一号展厅 A-03 展柜"></div>
    </div>
    <div class="field"><label>物品描述</label><textarea id="fDesc">${esc(it.description)}</textarea></div>
    <div class="field"><label>背后故事</label><textarea id="fStory" style="min-height:130px">${esc(it.story)}</textarea></div>
    ${id ? '<p style="font-size:12px;color:#999">提示：图片请在列表中点击「图片」管理；未审核通过的物品无法设为公开。</p>' : '<p style="font-size:12px;color:#999">保存后可在列表中点击「图片」上传照片。</p>'}
    <div class="actions"><button class="btn gray" onclick="closeModal()">取消</button>
      <button class="btn" onclick="saveItem(${id || 'null'})">保存</button></div>`, true);
}
async function saveItem(id) {
  const body = {
    code: $('#fCode').value.trim(), name: $('#fName').value.trim(),
    donor_id: $('#fDonor').value || null, category_id: $('#fCat').value || null,
    era: $('#fEra').value.trim(), acquired_date: $('#fDate').value,
    display_status: $('#fDisplay').value, visibility: $('#fVis').value,
    location: $('#fLoc').value.trim(), description: $('#fDesc').value.trim(), story: $('#fStory').value.trim(),
  };
  try {
    if (id) await api('/api/admin/items/' + id, { method: 'PUT', body });
    else await api('/api/admin/items', { method: 'POST', body });
    closeModal(); toast('已保存'); loadItems(); refreshBadges();
  } catch (e) { toast(e.message, false); }
}
async function delItem(id, name) {
  if (!confirm(`确定删除物品「${name}」？其图片与更正记录将一并删除，不可恢复。`)) return;
  try { await api('/api/admin/items/' + id, { method: 'DELETE' }); toast('已删除'); loadItems(); refreshBadges(); }
  catch (e) { toast(e.message, false); }
}
async function toggleVis(id, visibility) {
  try { await api(`/api/admin/items/${id}/visibility`, { method: 'PUT', body: { visibility } });
    toast(visibility === 'public' ? '已公开' : '已下架'); loadItems(); refreshBadges();
  } catch (e) { toast(e.message, false); }
}

/* ---- 审核 ---- */
function openReviewModal(id, name) {
  openModal(`<h3>审核「${esc(name)}」</h3>
    <div class="field"><label>审核意见（驳回时填写原因，将通过导出记录存档）</label>
      <textarea id="rvComment" placeholder="审核意见…"></textarea></div>
    <div class="field"><label>通过后的公开设置</label>
      <select id="rvVis"><option value="public">审核通过并公开（前台可见）</option><option value="private">审核通过但暂不公开</option></select></div>
    <div class="actions">
      <button class="btn gray" onclick="closeModal()">取消</button>
      <button class="btn danger" onclick="doReview(${id}, 'reject')">驳 回</button>
      <button class="btn green" onclick="doReview(${id}, 'approve')">通 过</button>
    </div>`);
}
async function doReview(id, action) {
  try {
    await api(`/api/admin/items/${id}/review`, { method: 'POST',
      body: { action, comment: $('#rvComment').value.trim(), visibility: $('#rvVis').value } });
    closeModal(); toast(action === 'approve' ? '已通过' : '已驳回');
    refreshBadges();
    if ($('#itemTable')) loadItems(); else pageReview();
  } catch (e) { toast(e.message, false); }
}

/* ---- 图片管理 ---- */
async function openImageModal(itemId, name) {
  const { item } = await api('/api/admin/items/' + itemId);
  openModal(`<h3>图片管理 · ${esc(name)}</h3>
    <div class="field"><label>上传图片（JPG/PNG/GIF/WebP，单张 ≤ 5MB，可多选）</label>
      <input type="file" id="imgFiles" accept="image/*" multiple></div>
    <div class="img-grid" id="imgGrid">${renderImgs(item.images)}</div>
    <div class="actions"><button class="btn gray" onclick="closeModal()">关闭</button>
      <button class="btn" onclick="uploadImgs(${itemId}, '${esc(name)}')">上传所选图片</button></div>`, true);
}
function renderImgs(images) {
  if (!images.length) return '<p style="color:#999;font-size:13px;grid-column:1/-1">暂无图片</p>';
  return images.map((im) => `<div class="img-cell">
    ${im.is_primary ? '<span class="primary-mark">主图</span>' : ''}
    <img src="/uploads/${im.filename}" loading="lazy">
    <div class="ibar">
      ${im.is_primary ? '' : `<button onclick="setPrimary(${im.id}, ${im.item_id})">设主图</button>`}
      <button onclick="moveImg(${im.id}, ${im.item_id}, -1)">前移</button>
      <button onclick="moveImg(${im.id}, ${im.item_id}, 1)">后移</button>
      <button onclick="delImg(${im.id}, ${im.item_id})" style="color:var(--red)">删除</button>
    </div></div>`).join('');
}
async function refreshImgGrid(itemId) {
  const { item } = await api('/api/admin/items/' + itemId);
  $('#imgGrid').innerHTML = renderImgs(item.images);
}
async function uploadImgs(itemId, name) {
  const files = $('#imgFiles').files;
  if (!files.length) return toast('请先选择图片', false);
  const fd = new FormData();
  for (const f of files) fd.append('images', f);
  try {
    await api(`/api/admin/items/${itemId}/images`, { method: 'POST', body: fd });
    toast('上传成功'); refreshImgGrid(itemId); refreshBadges();
  } catch (e) { toast(e.message, false); }
}
async function setPrimary(imgId, itemId) {
  await api(`/api/admin/images/${imgId}/primary`, { method: 'PUT' });
  refreshImgGrid(itemId);
}
async function moveImg(imgId, itemId, dir) {
  const { item } = await api('/api/admin/items/' + itemId);
  const idx = item.images.findIndex((i) => i.id === imgId);
  const target = item.images[idx + dir];
  if (!target) return;
  await api(`/api/admin/images/${imgId}/sort`, { method: 'PUT', body: { sort_order: target.sort_order } });
  await api(`/api/admin/images/${target.id}/sort`, { method: 'PUT', body: { sort_order: item.images[idx].sort_order } });
  refreshImgGrid(itemId);
}
async function delImg(imgId, itemId) {
  if (!confirm('删除该图片？')) return;
  await api('/api/admin/images/' + imgId, { method: 'DELETE' });
  refreshImgGrid(itemId);
}

/* ================= 审核中心 ================= */
async function pageReview() {
  const data = await api('/api/admin/items?review_status=pending&page_size=100');
  main.innerHTML = `
    <div class="page-title">审核中心 <span class="tag orange">${data.total} 件待审核</span></div>
    <div class="panel">${data.items.length ? `<table class="tbl"><thead><tr>
        <th>编号</th><th>名称</th><th>分类</th><th>捐赠人</th><th>年代</th><th>登记人</th><th>登记时间</th><th>操作</th>
      </tr></thead><tbody>${data.items.map((it) => `<tr>
        <td>${esc(it.code)}</td><td><b>${esc(it.name)}</b></td>
        <td>${esc(it.category_name || '—')}</td><td>${esc(it.donor_name || '—')}</td>
        <td>${esc(it.era || '—')}</td><td>${esc(it.creator_name || '—')}</td>
        <td style="font-size:12px">${it.created_at}</td>
        <td class="ops"><a onclick="viewItem(${it.id})">查看</a><a onclick="openReviewModal(${it.id}, '${esc(it.name)}')">审核</a></td>
      </tr>`).join('')}</tbody></table>`
      : '<p style="color:#999;text-align:center;padding:30px">🎉 没有待审核的资料</p>'}
    </div>`;
}
async function viewItem(id) {
  const { item } = await api('/api/admin/items/' + id);
  openModal(`<h3>${esc(item.name)} <span class="tag">${esc(item.code)}</span></h3>
    <dl class="kv" style="display:grid;grid-template-columns:90px 1fr;gap:6px 14px;font-size:14px">
      <dt style="color:#999">分类</dt><dd>${esc(item.category_name || '—')}</dd>
      <dt style="color:#999">捐赠人</dt><dd>${esc(item.donor_name || '—')}</dd>
      <dt style="color:#999">年代</dt><dd>${esc(item.era || '—')}</dd>
      <dt style="color:#999">捐赠日期</dt><dd>${esc(item.acquired_date || '—')}</dd>
      <dt style="color:#999">展示状态</dt><dd>${DISPLAY_CN[item.display_status]}</dd>
      <dt style="color:#999">位置</dt><dd>${esc(item.location || '—')}</dd>
    </dl>
    <div class="section-title">物品描述</div><p style="font-size:14px">${esc(item.description || '暂无')}</p>
    <div class="section-title">背后故事</div><div class="story-box" style="font-size:14px">${esc(item.story || '暂无')}</div>
    <div class="section-title">图片（${item.images.length}）</div>
    <div class="img-grid">${item.images.map((im) => `<div class="img-cell"><img src="/uploads/${im.filename}"></div>`).join('') || '<p style="color:#999;font-size:13px">暂无图片</p>'}</div>
    <div class="actions"><button class="btn gray" onclick="closeModal()">关闭</button>
      <button class="btn" onclick="closeModal();openReviewModal(${item.id}, '${esc(item.name)}')">去审核</button></div>`, true);
}

/* ================= 更正申请 ================= */
async function pageCorrections() {
  const data = await api('/api/admin/corrections');
  main.innerHTML = `
    <div class="page-title">更正申请</div>
    <div class="panel">${data.corrections.length ? `<table class="tbl"><thead><tr>
        <th>#</th><th>物品</th><th>提交人</th><th>联系方式</th><th>更正说明</th><th>状态</th><th>提交时间</th><th>操作</th>
      </tr></thead><tbody>${data.corrections.map((c) => `<tr>
        <td>${c.id}</td>
        <td>${esc(c.item_name)}<br><span style="color:#999;font-size:12px">${esc(c.item_code)}</span></td>
        <td>${esc(c.donor_name)}</td><td>${esc(c.contact || '—')}</td>
        <td style="max-width:280px">${esc(c.content)}</td>
        <td>${corrTag(c.status)}${c.admin_reply ? `<br><span style="font-size:12px;color:#999">回复：${esc(c.admin_reply)}</span>` : ''}</td>
        <td style="font-size:12px">${c.created_at}</td>
        <td class="ops">${c.status === 'pending' ? `<a onclick="openCorrModal(${c.id})">处理</a>` : `<span style="color:#999;font-size:12px">${esc(c.processor_name || '')}</span>`}</td>
      </tr>`).join('')}</tbody></table>`
      : '<p style="color:#999;text-align:center;padding:30px">暂无更正申请</p>'}
    </div>`;
}
function openCorrModal(id) {
  openModal(`<h3>处理更正申请 #${id}</h3>
    <div class="field"><label>处理回复（将记录存档，采纳后请同步修改物品资料）</label>
      <textarea id="corrReply" placeholder="例如：已核实并修改年代信息，感谢指正。"></textarea></div>
    <div class="actions">
      <button class="btn gray" onclick="closeModal()">取消</button>
      <button class="btn danger" onclick="doCorr(${id}, 'reject')">驳 回</button>
      <button class="btn green" onclick="doCorr(${id}, 'accept')">采纳</button>
    </div>`);
}
async function doCorr(id, action) {
  try {
    await api(`/api/admin/corrections/${id}/process`, { method: 'POST',
      body: { action, reply: $('#corrReply').value.trim() } });
    closeModal(); toast('已处理'); pageCorrections(); refreshBadges();
  } catch (e) { toast(e.message, false); }
}

/* ================= 捐赠人 ================= */
async function pageDonors() {
  main.innerHTML = `
    <div class="page-title">捐赠人管理
      <button class="btn" onclick="openDonorModal()">＋ 登记捐赠人</button></div>
    <div class="panel">
      <div class="toolbar"><input id="dKw" placeholder="姓名 / 联系方式" style="width:220px">
        <button class="btn small" onclick="loadDonors()">查询</button></div>
      <div id="donorTable"></div>
    </div>`;
  $('#dKw').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadDonors(); });
  await loadDonors();
}
async function loadDonors() {
  const kw = ($('#dKw') || {}).value || '';
  const data = await api('/api/admin/donors' + (kw ? '?keyword=' + encodeURIComponent(kw) : ''));
  $('#donorTable').innerHTML = `<table class="tbl"><thead><tr>
      <th>姓名</th><th>联系方式</th><th>地址</th><th>捐赠物品数</th><th>备注</th><th>登记时间</th><th>操作</th>
    </tr></thead><tbody>${data.donors.map((d) => `<tr>
      <td><b>${esc(d.name)}</b></td><td>${esc(d.contact || '—')}</td><td>${esc(d.address || '—')}</td>
      <td>${d.item_count}</td><td style="max-width:200px">${esc(d.notes || '—')}</td>
      <td style="font-size:12px">${d.created_at}</td>
      <td class="ops"><a onclick="openDonorModal(${d.id})">编辑</a>
        <a class="danger" onclick="delDonor(${d.id}, '${esc(d.name)}')">删除</a></td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px">暂无数据</td></tr>'}
    </tbody></table>`;
}
async function openDonorModal(id) {
  let d = { name: '', contact: '', address: '', id_number: '', notes: '' };
  if (id) d = (await api('/api/admin/donors/' + id)).donor;
  openModal(`<h3>${id ? '编辑捐赠人' : '登记捐赠人'}</h3>
    <div class="form-row">
      <div class="field"><label>姓名 <span class="req">*</span></label><input id="dfName" value="${esc(d.name)}"></div>
      <div class="field"><label>联系方式</label><input id="dfContact" value="${esc(d.contact)}"></div>
      <div class="field"><label>地址</label><input id="dfAddr" value="${esc(d.address)}"></div>
      <div class="field"><label>证件号（存档用，不公开）</label><input id="dfIdNum" value="${esc(d.id_number)}"></div>
    </div>
    <div class="field"><label>备注</label><textarea id="dfNotes">${esc(d.notes)}</textarea></div>
    <div class="actions"><button class="btn gray" onclick="closeModal()">取消</button>
      <button class="btn" onclick="saveDonor(${id || 'null'})">保存</button></div>`);
}
async function saveDonor(id) {
  const body = { name: $('#dfName').value.trim(), contact: $('#dfContact').value.trim(),
    address: $('#dfAddr').value.trim(), id_number: $('#dfIdNum').value.trim(), notes: $('#dfNotes').value.trim() };
  try {
    if (id) await api('/api/admin/donors/' + id, { method: 'PUT', body });
    else await api('/api/admin/donors', { method: 'POST', body });
    closeModal(); toast('已保存'); loadDonors();
  } catch (e) { toast(e.message, false); }
}
async function delDonor(id, name) {
  if (!confirm(`确定删除捐赠人「${name}」？`)) return;
  try { await api('/api/admin/donors/' + id, { method: 'DELETE' }); toast('已删除'); loadDonors(); }
  catch (e) { toast(e.message, false); }
}

/* ================= 分类管理 ================= */
async function pageCategories() {
  const data = await api('/api/admin/categories');
  main.innerHTML = `
    <div class="page-title">分类管理
      <button class="btn" onclick="openCatModal()">＋ 新增分类</button></div>
    <div class="panel"><table class="tbl"><thead><tr>
        <th>排序</th><th>名称</th><th>说明</th><th>物品数</th><th>操作</th>
      </tr></thead><tbody>${data.categories.map((c) => `<tr>
        <td>${c.sort_order}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.description || '—')}</td>
        <td>${c.item_count}</td>
        <td class="ops"><a onclick='openCatModal(${JSON.stringify(c)})'>编辑</a>
          <a class="danger" onclick="delCat(${c.id}, '${esc(c.name)}')">删除</a></td>
      </tr>`).join('')}</tbody></table></div>`;
}
function openCatModal(c) {
  c = c || { name: '', description: '', sort_order: 0 };
  openModal(`<h3>${c.id ? '编辑分类' : '新增分类'}</h3>
    <div class="field"><label>分类名称 <span class="req">*</span></label><input id="cfName" value="${esc(c.name)}"></div>
    <div class="field"><label>说明</label><textarea id="cfDesc" style="min-height:70px">${esc(c.description)}</textarea></div>
    <div class="field"><label>排序（数字越小越靠前）</label><input id="cfSort" type="number" value="${c.sort_order}"></div>
    <div class="actions"><button class="btn gray" onclick="closeModal()">取消</button>
      <button class="btn" onclick="saveCat(${c.id || 'null'})">保存</button></div>`);
}
async function saveCat(id) {
  const body = { name: $('#cfName').value.trim(), description: $('#cfDesc').value.trim(),
    sort_order: parseInt($('#cfSort').value, 10) || 0 };
  try {
    if (id) await api('/api/admin/categories/' + id, { method: 'PUT', body });
    else await api('/api/admin/categories', { method: 'POST', body });
    closeModal(); toast('已保存'); pageCategories();
  } catch (e) { toast(e.message, false); }
}
async function delCat(id, name) {
  if (!confirm(`确定删除分类「${name}」？`)) return;
  try { await api('/api/admin/categories/' + id, { method: 'DELETE' }); toast('已删除'); pageCategories(); }
  catch (e) { toast(e.message, false); }
}

/* ================= 数据导出 ================= */
function pageExport() {
  main.innerHTML = `
    <div class="page-title">数据导出</div>
    <div class="panel">
      <p style="color:#777;font-size:14px;margin-bottom:20px">导出为 CSV 文件（UTF-8 带 BOM，可直接用 Excel 打开），导出内容包含全部登记资料（含未公开数据，请注意保密）。</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <a class="btn" href="/api/admin/export/items">📦 导出捐赠物品台账</a>
        <a class="btn green" href="/api/admin/export/donors">👤 导出捐赠人名录</a>
        <a class="btn gray" href="/api/admin/export/corrections">✎ 导出更正申请记录</a>
      </div>
    </div>`;
}

/* ================= 账号管理 ================= */
async function pageAdmins() {
  const data = await api('/api/admin/admins');
  main.innerHTML = `
    <div class="page-title">账号管理
      <button class="btn" onclick="openAdminModal()">＋ 新增工作人员</button></div>
    <div class="panel"><table class="tbl"><thead><tr>
        <th>用户名</th><th>姓名</th><th>角色</th><th>创建时间</th><th>操作</th>
      </tr></thead><tbody>${data.admins.map((a) => `<tr>
        <td>${esc(a.username)}</td><td><b>${esc(a.display_name)}</b></td>
        <td>${a.role === 'admin' ? '<span class="tag red">管理员</span>' : '<span class="tag">工作人员</span>'}</td>
        <td style="font-size:12px">${a.created_at}</td>
        <td class="ops"><a onclick="resetPwd(${a.id}, '${esc(a.display_name)}')">重置密码</a></td>
      </tr>`).join('')}</tbody></table></div>`;
}
function openAdminModal() {
  openModal(`<h3>新增工作人员</h3>
    <div class="form-row">
      <div class="field"><label>用户名 <span class="req">*</span></label><input id="afUser"></div>
      <div class="field"><label>姓名 <span class="req">*</span></label><input id="afName"></div>
      <div class="field"><label>初始密码（至少 6 位）</label><input id="afPwd" type="password"></div>
      <div class="field"><label>角色</label><select id="afRole">
        <option value="staff">工作人员</option><option value="admin">管理员</option></select></div>
    </div>
    <div class="actions"><button class="btn gray" onclick="closeModal()">取消</button>
      <button class="btn" onclick="saveAdmin()">创建</button></div>`);
}
async function saveAdmin() {
  try {
    await api('/api/admin/admins', { method: 'POST', body: {
      username: $('#afUser').value.trim(), display_name: $('#afName').value.trim(),
      password: $('#afPwd').value, role: $('#afRole').value } });
    closeModal(); toast('已创建'); pageAdmins();
  } catch (e) { toast(e.message, false); }
}
async function resetPwd(id, name) {
  const pwd = prompt(`为「${name}」设置新密码（至少 6 位）：`);
  if (!pwd) return;
  try {
    await api(`/api/admin/admins/${id}/password`, { method: 'PUT', body: { password: pwd } });
    toast('密码已重置');
  } catch (e) { toast(e.message, false); }
}

boot();
