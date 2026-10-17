/* LaptopStore - trang quản trị */
const $ = (s, el = document) => el.querySelector(s);
const fmt = n => Number(n || 0).toLocaleString('vi-VN') + '₫';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#root');
const S = { user: null, tab: 'stats', meta: null };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
  return data;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

/* ---------- Đăng nhập ---------- */
function loginView(msg = '') {
  root.innerHTML = `<form class="login" id="lf"><h2>Quản trị LaptopStore</h2><p>Đăng nhập bằng tài khoản quản trị viên.</p>
    <input name="email" type="email" placeholder="Email" value="admin@laptopstore.vn" required>
    <input name="password" type="password" placeholder="Mật khẩu" required>
    ${msg ? `<div class="err" style="margin:0 0 10px">${esc(msg)}</div>` : ''}<button class="btn" type="submit">Đăng nhập</button>
    <p style="margin-top:12px"><a href="/">← Về cửa hàng</a></p></form>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      if (user.role !== 'admin') { await api('/auth/logout', { method: 'POST' }); return loginView('Tài khoản này không có quyền quản trị'); }
      S.user = user; shell();
    } catch (ex) { loginView(ex.message); }
  };
}

/* ---------- Khung chính ---------- */
function shell() {
  root.innerHTML = `<div class="top"><b>Laptop<span>Store</span> Admin</b>
    <nav>${[['stats', 'Thống kê'], ['products', 'Sản phẩm'], ['orders', 'Đơn hàng']].map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
    <span class="sp"></span><a href="/" target="_blank">Xem cửa hàng ↗</a><button class="lo" id="lo">Đăng xuất (${esc(S.user.name)})</button></div><main id="main"></main>`;
  root.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { S.tab = b.dataset.t; shell(); });
  $('#lo').onclick = async () => { await api('/auth/logout', { method: 'POST' }); S.user = null; loginView(); };
  ({ stats, products, orders })[S.tab]().catch(e => { $('#main').innerHTML = `<div class="panel err">${esc(e.message)}</div>`; });
}

/* ---------- Thống kê ---------- */
async function stats() {
  const s = await api('/admin/stats');
  const max = Math.max(1, ...s.daily.map(d => d.revenue));
  $('#main').innerHTML = `<div class="cards">
    <div class="stat"><small>Doanh thu (không tính đơn hủy)</small><b>${fmt(s.revenue)}</b></div>
    <div class="stat"><small>Tổng đơn hàng</small><b>${s.orders}</b></div>
    <div class="stat"><small>Đơn chờ xác nhận</small><b style="color:#d97706">${s.pending}</b></div>
    <div class="stat"><small>Sản phẩm đang bán</small><b>${s.products}</b></div>
    <div class="stat"><small>Khách hàng</small><b>${s.customers}</b></div></div>
  <div class="two"><div class="panel"><h3>Doanh thu 7 ngày gần nhất</h3>
    ${s.daily.length ? `<div class="bars">${s.daily.map(d => `<div class="bar"><em>${(d.revenue / 1e6).toFixed(1)}tr</em><i style="height:${Math.max(3, d.revenue / max * 130)}px"></i><span>${d.day.slice(5)}</span></div>`).join('')}</div>` : '<p style="color:var(--muted)">Chưa có đơn hàng nào.</p>'}</div>
    <div><div class="panel"><h3>Sắp hết hàng (≤ 5)</h3>${s.low_stock.length ? `<table>${s.low_stock.map(p => `<tr><td>${esc(p.name)}</td><td><b style="color:#b91c1c">${p.stock}</b></td></tr>`).join('')}</table>` : '<p style="color:var(--muted)">Kho ổn định.</p>'}</div>
    <div class="panel"><h3>Bán chạy nhất</h3>${s.top.length ? `<table>${s.top.map(p => `<tr><td>${esc(p.name)}</td><td><b>${p.qty}</b></td></tr>`).join('')}</table>` : '<p style="color:var(--muted)">Chưa có dữ liệu.</p>'}</div></div></div>`;
}

/* ---------- Sản phẩm ---------- */
const CATS = ['Gaming', 'Văn phòng', 'Mỏng nhẹ', 'Đồ họa', 'Sinh viên'];
async function products(q = '') {
  const { items } = await api('/admin/products?q=' + encodeURIComponent(q));
  $('#main').innerHTML = `<div class="panel"><div class="bar-tools"><input id="pq" placeholder="Tìm theo tên, hãng, CPU…" value="${esc(q)}"><button class="btn" id="addP">+ Thêm sản phẩm</button></div>
    <div class="scroll"><table><thead><tr><th>ID</th><th>Sản phẩm</th><th>Nhu cầu</th><th>Giá bán</th><th>Kho</th><th>Đã bán</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${items.map(p => `<tr class="${p.active ? '' : 'off'}"><td>${p.id}</td><td><b>${esc(p.name)}</b><br><small style="color:var(--muted)">${esc(p.brand)} · ${esc(p.cpu)} · ${esc(p.ram)}</small></td>
      <td>${esc(p.category)}</td><td>${fmt(p.price)}${p.old_price > p.price ? `<br><small style="color:var(--muted);text-decoration:line-through">${fmt(p.old_price)}</small>` : ''}</td>
      <td style="${p.stock <= 5 ? 'color:#b91c1c;font-weight:700' : ''}">${p.stock}</td><td>${p.sold}</td><td>${p.active ? 'Đang bán' : 'Đã ẩn'}</td>
      <td style="white-space:nowrap"><button class="btn gray sm" data-e="${p.id}">Sửa</button> ${p.active ? `<button class="btn ghost sm" data-h="${p.id}">Ẩn</button>` : `<button class="btn gray sm" data-s="${p.id}">Hiện</button>`}</td></tr>`).join('') || '<tr><td colspan="8">Không có sản phẩm.</td></tr>'}</tbody></table></div></div>`;
  let t; $('#pq').oninput = e => { clearTimeout(t); t = setTimeout(() => products(e.target.value).then(() => { const i = $('#pq'); i.focus(); i.setSelectionRange(99, 99); }), 300); };
  $('#addP').onclick = () => productDialog();
  const byId = Object.fromEntries(items.map(p => [p.id, p]));
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => productDialog(byId[b.dataset.e]));
  document.querySelectorAll('[data-h]').forEach(b => b.onclick = async () => { if (confirm('Ẩn sản phẩm này khỏi cửa hàng?')) { await api('/admin/products/' + b.dataset.h, { method: 'DELETE' }); toast('Đã ẩn sản phẩm'); products(q); } });
  document.querySelectorAll('[data-s]').forEach(b => b.onclick = async () => { await api('/admin/products/' + b.dataset.s, { method: 'PUT', body: { active: 1 } }); toast('Đã hiện sản phẩm'); products(q); });
}

function productDialog(p = null) {
  const v = k => esc(p ? p[k] : (k === 'category' ? 'Văn phòng' : k === 'os' ? 'Windows 11 Home' : ''));
  const f = (k, label, type = 'text', cls = '') => `<div class="${cls}"><label>${label}</label><input name="${k}" type="${type}" value="${v(k)}" ${type === 'number' ? 'min="0" step="any"' : ''}></div>`;
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form class="dlg" method="dialog"><h3>${p ? 'Sửa sản phẩm #' + p.id : 'Thêm sản phẩm mới'}</h3><div class="grid2">
    ${f('name', 'Tên sản phẩm *', 'text', 'full')}${f('brand', 'Hãng *')}
    <div><label>Nhu cầu</label><select name="category">${CATS.map(c => `<option ${p && p.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    ${f('price', 'Giá bán (₫) *', 'number')}${f('old_price', 'Giá gốc (₫)', 'number')}
    ${f('cpu', 'CPU')}${f('ram', 'RAM')}${f('storage', 'Ổ cứng')}${f('gpu', 'Card đồ họa')}${f('screen', 'Màn hình')}${f('weight', 'Trọng lượng (kg)', 'number')}
    ${f('battery', 'Pin')}${f('os', 'Hệ điều hành')}${f('stock', 'Tồn kho', 'number')}
    <div><label>Nổi bật</label><select name="featured"><option value="0">Không</option><option value="1" ${p && p.featured ? 'selected' : ''}>Có</option></select></div>
    <div class="full"><label>Mô tả</label><textarea name="description" rows="3">${p ? esc(p.description) : ''}</textarea></div></div>
    <div id="de" class="err" hidden></div>
    <div class="act"><button type="button" class="btn gray" id="dc">Hủy</button><button type="submit" class="btn">Lưu</button></div></form>`;
  document.body.appendChild(dlg); dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  $('#dc', dlg).onclick = close; dlg.addEventListener('cancel', () => dlg.remove());
  $('form', dlg).onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      await api(p ? '/admin/products/' + p.id : '/admin/products', { method: p ? 'PUT' : 'POST', body });
      close(); toast('Đã lưu sản phẩm'); products();
    } catch (ex) { const d = $('#de', dlg); d.textContent = ex.message; d.hidden = false; }
  };
}

/* ---------- Đơn hàng ---------- */
async function orders(status = '') {
  if (!S.meta) S.meta = await api('/meta');
  const { orders } = await api('/admin/orders' + (status ? '?status=' + status : ''));
  const st = S.meta.statuses;
  $('#main').innerHTML = `<div class="panel"><div class="bar-tools"><select id="fs"><option value="">Tất cả trạng thái</option>${Object.entries(st).map(([k, l]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${l}</option>`).join('')}</select><span style="align-self:center;color:var(--muted)">${orders.length} đơn</span></div>
    <div class="scroll"><table><thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Sản phẩm</th><th>Tổng tiền</th><th>Thanh toán</th><th>Trạng thái</th></tr></thead><tbody>
    ${orders.map(o => `<tr><td><b>${esc(o.code)}</b><br><small style="color:var(--muted)">${esc(o.created_at)}</small></td>
      <td>${esc(o.name)}<br><small>${esc(o.phone)}</small><br><small style="color:var(--muted)">${esc(o.address)}</small></td>
      <td><ul class="items">${o.items.map(i => `<li>${esc(i.name)} × ${i.qty}</li>`).join('')}</ul></td>
      <td><b>${fmt(o.total)}</b>${o.discount ? `<br><small style="color:#16a34a">-${fmt(o.discount)} (${esc(o.coupon)})</small>` : ''}</td>
      <td>${{ cod: 'COD', bank: 'Chuyển khoản', installment: 'Trả góp' }[o.payment] || o.payment}</td>
      <td>${o.status === 'cancelled' ? `<span class="tag cancelled">${st.cancelled}</span>` : `<select data-o="${o.id}">${Object.entries(st).map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</td></tr>`).join('') || '<tr><td colspan="6">Chưa có đơn hàng.</td></tr>'}
    </tbody></table></div></div>`;
  $('#fs').onchange = e => orders_(e.target.value);
  document.querySelectorAll('[data-o]').forEach(sel => sel.onchange = async () => {
    if (sel.value === 'cancelled' && !confirm('Hủy đơn này? Hàng sẽ được hoàn lại kho và không thể mở lại.')) { return orders_(status); }
    try { await api(`/admin/orders/${sel.dataset.o}/status`, { method: 'PUT', body: { status: sel.value } }); toast('Đã cập nhật trạng thái'); orders_(status); }
    catch (ex) { toast(ex.message); orders_(status); }
  });
}
const orders_ = s => orders(s);

(async function init() {
  try { const { user } = await api('/auth/me'); if (user && user.role === 'admin') { S.user = user; return shell(); } } catch { }
  loginView();
})();
