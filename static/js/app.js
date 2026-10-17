/* LaptopStore - front-end (SPA thuần JS, điều hướng bằng hash) */
const $ = (s, el = document) => el.querySelector(s);
const fmt = n => Number(n || 0).toLocaleString('vi-VN') + '₫';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra, vui lòng thử lại');
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------------- State ---------------- */
const state = { user: null, meta: null, timers: [] };
const Cart = {
  get() { try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch { return []; } },
  save(c) { localStorage.setItem('cart', JSON.stringify(c)); this.badge(); },
  add(id, qty = 1, stock = 10) {
    const c = this.get(); const it = c.find(x => x.id === id);
    const max = Math.min(10, stock);
    if (it) it.qty = Math.min(max, it.qty + qty); else c.push({ id, qty: Math.min(max, qty) });
    this.save(c);
  },
  set(id, qty) { const c = this.get(); const it = c.find(x => x.id === id); if (it) it.qty = qty; this.save(c); },
  remove(id) { this.save(this.get().filter(x => x.id !== id)); },
  clear() { this.save([]); },
  count() { return this.get().reduce((a, b) => a + b.qty, 0); },
  badge() { $('#cartBadge').textContent = this.count(); },
};
const coupon = { get: () => sessionStorage.getItem('coupon') || '', set: c => sessionStorage.setItem('coupon', c), clear: () => sessionStorage.removeItem('coupon') };

/* ---------------- Ảnh minh họa (SVG, không cần file ảnh) ---------------- */
function laptopSVG(p) {
  const hue = [...p.brand].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360;
  const sub = (p.gpu.match(/RTX \d+/) || p.cpu.match(/M\d( Pro)?|Ultra \d|i\d|Ryzen[^,]*/) || [''])[0];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue},75%,55%)'/><stop offset='1' stop-color='hsl(${(hue + 60) % 360},80%,22%)'/></linearGradient></defs>
<rect width='400' height='300' fill='#f3f4f6'/>
<rect x='70' y='34' width='260' height='170' rx='12' fill='#16181d'/>
<rect x='80' y='44' width='240' height='150' rx='4' fill='url(#g)'/>
<text x='200' y='122' font-family='Arial,sans-serif' font-weight='800' font-size='30' fill='#fff' text-anchor='middle'>${esc(p.brand)}</text>
<text x='200' y='152' font-family='Arial,sans-serif' font-size='16' fill='#fff' fill-opacity='.85' text-anchor='middle'>${esc(sub)}</text>
<path d='M38 212h324l-18 30a14 14 0 0 1-12 8H68a14 14 0 0 1-12-8z' fill='#cfd2d9'/>
<rect x='168' y='216' width='64' height='5' rx='2.5' fill='#9ca0aa'/></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/* ---------------- Thành phần dùng chung ---------------- */
function card(p) {
  const short = (s) => esc(String(s).split(' ')[0]);
  return `<a class="card" href="#/product/${p.id}">
    ${p.discount ? `<span class="badge">Giảm ${p.discount}%</span>` : ''}
    <span class="tag-tg">Trả góp 0%</span>
    <img loading="lazy" src="${laptopSVG(p)}" alt="${esc(p.name)}">
    <h3>${esc(p.name)}</h3>
    <div class="specs"><span>${short(p.ram)}</span><span>${short(p.storage)}</span><span>${short(p.screen)}</span></div>
    <div><span class="price">${fmt(p.price)}</span> ${p.old_price > p.price ? `<span class="old">${fmt(p.old_price)}</span>` : ''}</div>
    <div class="card-foot">★ ${p.rating} · Đã bán ${p.sold}</div>
    ${p.stock > 0 ? `<button class="btn-add" data-add="${p.id}" data-stock="${p.stock}">Thêm vào giỏ</button>` : `<div class="out">Tạm hết hàng</div>`}
  </a>`;
}
const stockLabel = s => s <= 0 ? '<span class="stock-no">Hết hàng</span>' : s <= 5 ? `<span class="stock-low">Chỉ còn ${s} sản phẩm</span>` : '<span class="stock-ok">Còn hàng</span>';
const loading = () => (app.innerHTML = '<div class="loading">Đang tải…</div>');
const fail = e => (app.innerHTML = `<div class="box empty"><div class="big">😕</div><p>${esc(e.message)}</p><a class="btn" href="#/">Về trang chủ</a></div>`);

function freeShipFrom() { return state.meta ? state.meta.free_ship_from : 5000000; }
function shipFee() { return state.meta ? state.meta.ship_fee : 30000; }

/* Gom dữ liệu giỏ hàng (giá lấy từ server) */
async function loadCart() {
  const cart = Cart.get();
  let lines = [];
  if (cart.length) {
    const { items } = await api('/products?limit=60&ids=' + cart.map(c => c.id).join(','));
    const map = Object.fromEntries(items.map(p => [p.id, p]));
    const fixed = [];
    for (const c of cart) {
      const p = map[c.id]; if (!p) continue;
      const qty = Math.max(1, Math.min(c.qty, p.stock || 1, 10));
      fixed.push({ id: c.id, qty });
      lines.push({ p, qty });
    }
    if (JSON.stringify(fixed) !== JSON.stringify(cart)) Cart.save(fixed);
  }
  const subtotal = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  let disc = null;
  const code = coupon.get();
  if (code && subtotal) {
    try { disc = await api('/coupon/check', { method: 'POST', body: { code, subtotal } }); }
    catch (e) { coupon.clear(); toast(e.message, true); }
  }
  const discount = disc ? disc.discount : 0;
  const shipping = subtotal && subtotal < freeShipFrom() ? shipFee() : 0;
  return { lines, subtotal, discount, disc, shipping, total: subtotal - discount + shipping };
}

function summaryHTML(c) {
  return `<div class="sum-row"><span>Tạm tính</span><b>${fmt(c.subtotal)}</b></div>
  ${c.discount ? `<div class="sum-row"><span>Giảm giá (${esc(c.disc.code)})</span><b style="color:var(--green)">-${fmt(c.discount)}</b></div>` : ''}
  <div class="sum-row"><span>Phí vận chuyển</span><b>${c.shipping ? fmt(c.shipping) : 'Miễn phí'}</b></div>
  <div class="sum-row total"><span>Tổng cộng</span><span>${fmt(c.total)}</span></div>`;
}

function couponHTML(c) {
  return `<div class="coupon"><input id="couponIn" placeholder="Nhập mã giảm giá" value="${esc(coupon.get())}"><button class="btn ghost" id="couponBtn" type="button">Áp dụng</button></div>
  ${c.disc ? `<div class="coupon-ok">✓ ${esc(c.disc.desc)}</div>` : ''}
  <div class="coupon-list">Thử mã: ${state.meta.coupons.map(x => `<code data-coupon="${x.code}" title="${esc(x.desc)}">${x.code}</code>`).join(' ')}</div>`;
}
function bindCoupon(rerender) {
  const apply = code => { coupon.set(code.trim().toUpperCase()); rerender(); };
  $('#couponBtn')?.addEventListener('click', () => apply($('#couponIn').value));
  $('#couponIn')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(e.target.value); } });
  document.querySelectorAll('[data-coupon]').forEach(el => el.addEventListener('click', () => apply(el.dataset.coupon)));
}

/* ---------------- Trang chủ ---------------- */
const SLIDES = [
  { bg: 'linear-gradient(120deg,#d70018,#7a0010)', emoji: '🎮', h: 'Laptop Gaming<br>giảm đến 5 triệu', p: 'RTX 40 Series, màn hình 144–165Hz, trả góp 0%.', link: '#/products?category=Gaming' },
  { bg: 'linear-gradient(120deg,#1d4ed8,#0f172a)', emoji: '🍎', h: 'MacBook chính hãng<br>giá cực tốt', p: 'MacBook Air M2/M3, MacBook Pro M3 Pro – pin cả ngày dài.', link: '#/products?brand=Apple' },
  { bg: 'linear-gradient(120deg,#059669,#064e3b)', emoji: '🎓', h: 'Sinh viên – Nhập mã<br>SINHVIEN giảm 300K', p: 'Laptop học tập bền bỉ, nhẹ, pin trâu.', link: '#/products?category=Sinh viên' },
];

async function home() {
  loading();
  const [flash, gaming, office, slim, newest] = await Promise.all([
    api('/products?sort=discount&limit=5'), api('/products?category=Gaming&limit=5'),
    api('/products?category=Văn phòng,Sinh viên&limit=5'), api('/products?category=Mỏng nhẹ&limit=5'),
    api('/products?sort=newest&limit=5'),
  ]);
  const icons = { 'Gaming': '🎮', 'Văn phòng': '💼', 'Mỏng nhẹ': '🪶', 'Đồ họa': '🎨', 'Sinh viên': '🎓' };
  const sec = (title, link, items, cls = '') => `<section class="sec ${cls}"><div class="sec-head"><h2>${title}</h2><a class="more" href="${link}">Xem tất cả ›</a></div><div class="grid five">${items.items.map(card).join('')}</div></section>`;
  app.innerHTML = `
  <section class="hero">
    <div class="slider" id="slider">
      ${SLIDES.map((s, i) => `<div class="slide ${i ? '' : 'on'}" style="background:${s.bg}"><h2>${s.h}</h2><p>${s.p}</p><a class="btn" href="${s.link}">Mua ngay</a><span class="emoji">${s.emoji}</span></div>`).join('')}
      <div class="dots">${SLIDES.map((_, i) => `<i class="${i ? '' : 'on'}" data-i="${i}"></i>`).join('')}</div>
    </div>
    <div class="side-banners">
      <a class="sb" style="background:linear-gradient(135deg,#7c3aed,#4c1d95)" href="#/products?sort=price_asc"><b>Laptop giá rẻ</b><span>Từ 12 triệu, đủ dùng cho học tập</span></a>
      <a class="sb" style="background:linear-gradient(135deg,#ea580c,#9a3412)" href="#/products?category=Đồ họa"><b>Đồ họa – Sáng tạo</b><span>Màn OLED, hiệu năng mạnh mẽ</span></a>
    </div>
  </section>
  <section class="perks">
    <div class="perk"><i>✅</i><div><b>Chính hãng 100%</b>Hóa đơn VAT đầy đủ</div></div>
    <div class="perk"><i>🚚</i><div><b>Giao nhanh toàn quốc</b>Miễn phí từ 5 triệu</div></div>
    <div class="perk"><i>🔁</i><div><b>Đổi trả 30 ngày</b>Lỗi nhà sản xuất</div></div>
    <div class="perk"><i>💳</i><div><b>Trả góp 0%</b>Duyệt nhanh 15 phút</div></div>
  </section>
  <section class="cats">${state.meta.categories.map(c => `<a class="cat" href="#/products?category=${encodeURIComponent(c.name)}"><i>${icons[c.name] || '💻'}</i>${esc(c.name)}<small>${c.n} mẫu</small></a>`).join('')}</section>
  <section class="sec flash"><div class="sec-head"><h2>⚡ Flash sale hôm nay</h2><div class="cd" id="cd"></div><a class="more" href="#/products?sort=discount">Xem tất cả ›</a></div><div class="grid five">${flash.items.map(card).join('')}</div></section>
  ${sec('🎮 Laptop Gaming', '#/products?category=Gaming', gaming)}
  ${sec('💼 Văn phòng – Sinh viên', '#/products?category=Văn phòng,Sinh viên', office)}
  ${sec('🪶 Mỏng nhẹ – Cao cấp', '#/products?category=Mỏng nhẹ', slim)}
  ${sec('🆕 Sản phẩm mới', '#/products?sort=newest', newest)}
  <section class="sec"><div class="sec-head"><h2>Thương hiệu nổi bật</h2></div><div class="brands">${state.meta.brands.map(b => `<a class="brand" href="#/products?brand=${encodeURIComponent(b.name)}">${esc(b.name)}</a>`).join('')}</div></section>`;
  // slider
  let cur = 0; const slides = app.querySelectorAll('.slide'), dots = app.querySelectorAll('.dots i');
  const go = i => { cur = (i + slides.length) % slides.length; slides.forEach((s, k) => s.classList.toggle('on', k === cur)); dots.forEach((d, k) => d.classList.toggle('on', k === cur)); };
  dots.forEach(d => d.addEventListener('click', () => go(+d.dataset.i)));
  state.timers.push(setInterval(() => go(cur + 1), 5000));
  // đếm ngược đến hết ngày
  const tick = () => {
    const el = $('#cd'); if (!el) return;
    const end = new Date(); end.setHours(23, 59, 59, 999);
    let s = Math.max(0, Math.floor((end - new Date()) / 1000));
    const pad = n => String(n).padStart(2, '0');
    el.innerHTML = `Kết thúc sau <b>${pad(Math.floor(s / 3600))}</b>:<b>${pad(Math.floor(s % 3600 / 60))}</b>:<b>${pad(s % 60)}</b>`;
  };
  tick(); state.timers.push(setInterval(tick, 1000));
}

/* ---------------- Danh sách + bộ lọc ---------------- */
const PRICE_RANGES = [['', 'Tất cả mức giá'], ['0-15000000', 'Dưới 15 triệu'], ['15000000-25000000', '15 – 25 triệu'], ['25000000-35000000', '25 – 35 triệu'], ['35000000-', 'Trên 35 triệu']];
const SORT_OPTS = [['popular', 'Bán chạy nhất'], ['price_asc', 'Giá thấp → cao'], ['price_desc', 'Giá cao → thấp'], ['discount', 'Khuyến mãi hot'], ['newest', 'Mới nhất']];

async function products(query) {
  loading();
  const q = new URLSearchParams(query || '');
  const apiQ = new URLSearchParams(q); apiQ.set('limit', 12);
  const price = q.get('price') || '';
  if (price) { const [a, b] = price.split('-'); if (a) apiQ.set('price_min', a); if (b) apiQ.set('price_max', b); apiQ.delete('price'); }
  const res = await api('/products?' + apiQ);
  const sel = k => (q.get(k) || '').split(',').filter(Boolean);
  const [brands, cats, rams] = [sel('brand'), sel('category'), sel('ram')];
  const chk = (name, val, list, n) => `<label><input type="checkbox" data-f="${name}" value="${esc(val)}" ${list.includes(val) ? 'checked' : ''}> ${esc(val)} ${n != null ? `<small>${n}</small>` : ''}</label>`;
  const title = q.get('q') ? `Kết quả cho “${esc(q.get('q'))}”` : cats.length === 1 ? 'Laptop ' + esc(cats[0]) : brands.length === 1 ? 'Laptop ' + esc(brands[0]) : 'Tất cả laptop';
  const chips = [...brands, ...cats, ...rams.map(r => r + ' RAM'), ...(price ? [PRICE_RANGES.find(p => p[0] === price)?.[1] || ''] : [])];
  const mk = (patch) => { const n = new URLSearchParams(q); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); return '#/products?' + n; };
  const pages = Array.from({ length: res.pages }, (_, i) => i + 1);
  app.innerHTML = `
  <div class="crumbs"><a href="#/">Trang chủ</a> › ${title}</div>
  <div class="list">
    <aside class="box filters" id="filters">
      <h4>Hãng sản xuất</h4>${state.meta.brands.map(b => chk('brand', b.name, brands, b.n)).join('')}
      <h4>Nhu cầu</h4>${state.meta.categories.map(c => chk('category', c.name, cats, c.n)).join('')}
      <h4>Mức giá</h4>${PRICE_RANGES.map(([v, l]) => `<label><input type="radio" name="price" data-f="price" value="${v}" ${price === v ? 'checked' : ''}> ${l}</label>`).join('')}
      <h4>Dung lượng RAM</h4>${['8GB', '16GB', '32GB'].map(r => chk('ram', r, rams)).join('')}
      <button class="btn ghost block" style="margin-top:14px" id="resetF">Xóa bộ lọc</button>
    </aside>
    <section>
      <div class="toolbar">
        <span class="total">${title} <span style="color:var(--muted);font-weight:400">(${res.total} sản phẩm)</span></span>
        ${chips.filter(Boolean).map(c => `<span class="chip">${esc(c)}</span>`).join('')}
        <select id="sortSel">${SORT_OPTS.map(([v, l]) => `<option value="${v}" ${(q.get('sort') || 'popular') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      ${res.items.length ? `<div class="grid">${res.items.map(card).join('')}</div>` : `<div class="box empty"><div class="big">🔍</div><p>Không tìm thấy sản phẩm phù hợp.</p><a class="btn" href="#/products">Xem tất cả laptop</a></div>`}
      ${res.pages > 1 ? `<div class="pager">${pages.map(p => `<a href="${mk({ page: p > 1 ? p : '' })}" class="${p === res.page ? 'on' : ''}">${p}</a>`).join('')}</div>` : ''}
    </section>
  </div>`;
  const apply = () => {
    const n = new URLSearchParams(q); n.delete('page');
    for (const k of ['brand', 'category', 'ram']) {
      const v = [...document.querySelectorAll(`[data-f="${k}"]:checked`)].map(i => i.value).join(',');
      v ? n.set(k, v) : n.delete(k);
    }
    const pr = document.querySelector('[data-f="price"]:checked')?.value; pr ? n.set('price', pr) : n.delete('price');
    location.hash = '#/products?' + n;
  };
  $('#filters').addEventListener('change', apply);
  $('#sortSel').addEventListener('change', e => { location.hash = mk({ sort: e.target.value, page: '' }); });
  $('#resetF').addEventListener('click', () => { const n = new URLSearchParams(); if (q.get('q')) n.set('q', q.get('q')); location.hash = '#/products?' + n; });
}

/* ---------------- Chi tiết sản phẩm ---------------- */
async function detail(id) {
  loading();
  const { product: p, related } = await api('/products/' + id);
  document.title = p.name + ' | LaptopStore';
  let qty = 1;
  const rows = [['Bộ vi xử lý (CPU)', p.cpu], ['RAM', p.ram], ['Ổ cứng', p.storage], ['Card đồ họa', p.gpu], ['Màn hình', p.screen], ['Trọng lượng', p.weight + ' kg'], ['Pin', p.battery], ['Hệ điều hành', p.os]];
  app.innerHTML = `
  <div class="crumbs"><a href="#/">Trang chủ</a> › <a href="#/products?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a> › ${esc(p.name)}</div>
  <div class="box detail">
    <div class="gallery"><img src="${laptopSVG(p)}" alt="${esc(p.name)}">
      <div class="policy"><div>🛡️ Bảo hành chính hãng 12–24 tháng</div><div>🔁 Đổi mới 30 ngày nếu lỗi NSX</div><div>🚚 Giao toàn quốc, kiểm tra hàng</div></div></div>
    <div>
      <h1 class="d-title">${esc(p.name)}</h1>
      <div class="d-meta"><span>★ ${p.rating}</span><span>Đã bán ${p.sold}</span><span>Hãng: <b>${esc(p.brand)}</b></span><span>${stockLabel(p.stock)}</span></div>
      <div class="d-price"><span class="price">${fmt(p.price)}</span>${p.old_price > p.price ? `<span class="old">${fmt(p.old_price)}</span><span class="off">-${p.discount}%</span>` : ''}</div>
      <div style="font-size:13.5px;color:var(--muted)">Hoặc trả góp 0% từ <b style="color:var(--text)">${fmt(Math.ceil(p.price / 12 / 1000) * 1000)}</b>/tháng (12 tháng)</div>
      <div class="promo"><h4>🎁 Ưu đãi kèm theo</h4><ul style="margin:0;padding-left:18px">
        <li>Tặng balo + chuột không dây chính hãng</li><li>Giảm thêm 300.000₫ cho sinh viên (mã SINHVIEN, đơn từ 8 triệu)</li><li>Hỗ trợ cài đặt phần mềm miễn phí trọn đời</li></ul></div>
      ${p.stock > 0 ? `<div class="buy-row"><div class="qty"><button id="qm">−</button><span id="qv">1</span><button id="qp">+</button></div></div>
      <div class="buy-row"><button class="btn" id="buyNow">MUA NGAY<small style="font-weight:400;margin-left:6px">Giao tận nơi</small></button><button class="btn ghost" id="addCart">🛒 Thêm vào giỏ</button></div>` : '<div class="box" style="background:#fef2f2;color:var(--red-d)">Sản phẩm tạm hết hàng. Vui lòng quay lại sau.</div>'}
    </div>
  </div>
  <div class="cols" style="margin-top:14px;grid-template-columns:1fr 1fr">
    <div class="box"><h2 style="font-size:18px;margin-bottom:10px">Thông số kỹ thuật</h2><table class="specs-t">${rows.map(r => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td></tr>`).join('')}</table></div>
    <div class="box"><h2 style="font-size:18px;margin-bottom:10px">Mô tả sản phẩm</h2><p style="margin:0;line-height:1.7">${esc(p.description)}</p></div>
  </div>
  ${related.length ? `<section class="sec"><div class="sec-head"><h2>Sản phẩm tương tự</h2></div><div class="grid five">${related.map(card).join('')}</div></section>` : ''}`;
  if (p.stock > 0) {
    const set = v => { qty = Math.max(1, Math.min(v, p.stock, 10)); $('#qv').textContent = qty; };
    $('#qm').onclick = () => set(qty - 1); $('#qp').onclick = () => set(qty + 1);
    $('#addCart').onclick = () => { Cart.add(p.id, qty, p.stock); toast('Đã thêm vào giỏ hàng ✓'); };
    $('#buyNow').onclick = () => { Cart.add(p.id, qty, p.stock); location.hash = '#/cart'; };
  }
}

/* ---------------- Giỏ hàng ---------------- */
async function cart() {
  loading();
  const c = await loadCart();
  if (!c.lines.length) { app.innerHTML = `<div class="box empty"><div class="big">🛒</div><p>Giỏ hàng của bạn đang trống.</p><a class="btn" href="#/products">Tiếp tục mua sắm</a></div>`; return; }
  const render = async () => { const n = await loadCart(); drawCart(n); };
  drawCart(c);
  function drawCart(c) {
    if (!c.lines.length) return cart();
    app.innerHTML = `<h1 style="font-size:22px;margin-bottom:12px">Giỏ hàng (${Cart.count()} sản phẩm)</h1>
    <div class="cols"><div class="box">${c.lines.map(({ p, qty }) => `
      <div class="line"><a href="#/product/${p.id}"><img src="${laptopSVG(p)}" alt=""></a>
        <div><h4><a href="#/product/${p.id}">${esc(p.name)}</a></h4>
          <div class="qty"><button data-q="${p.id}" data-d="-1">−</button><span>${qty}</span><button data-q="${p.id}" data-d="1">+</button></div>
          <button class="rm" data-rm="${p.id}">🗑 Xóa</button>
          ${qty >= p.stock ? `<div style="font-size:12px;color:#d97706;margin-top:4px">Đã đạt số lượng tối đa trong kho</div>` : ''}</div>
        <div class="lp"><div class="price">${fmt(p.price * qty)}</div>${p.old_price > p.price ? `<div class="old">${fmt(p.old_price * qty)}</div>` : ''}</div></div>`).join('')}</div>
      <div class="box"><h3 style="margin-bottom:8px">Thông tin đơn hàng</h3>${couponHTML(c)}${summaryHTML(c)}
        ${c.shipping ? `<div style="font-size:12.5px;color:var(--muted)">Mua thêm ${fmt(freeShipFrom() - c.subtotal)} để được miễn phí vận chuyển.</div>` : ''}
        <a class="btn block" style="margin-top:12px" href="#/checkout">Tiến hành đặt hàng</a>
        <a class="btn ghost block" style="margin-top:8px" href="#/products">Chọn thêm sản phẩm</a></div></div>`;
    app.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const id = +b.dataset.q; const l = c.lines.find(x => x.p.id === id); const nq = l.qty + +b.dataset.d; if (nq < 1) return; if (nq > Math.min(l.p.stock, 10)) return toast('Đã đạt số lượng tối đa', true); Cart.set(id, nq); render(); });
    app.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { Cart.remove(+b.dataset.rm); render(); });
    bindCoupon(render);
  }
}

/* ---------------- Thanh toán ---------------- */
async function checkout() {
  loading();
  const c = await loadCart();
  if (!c.lines.length) { location.hash = '#/cart'; return; }
  const u = state.user || {};
  const last = JSON.parse(localStorage.getItem('shipInfo') || '{}');
  app.innerHTML = `<h1 style="font-size:22px;margin-bottom:12px">Thanh toán</h1>
  <div class="cols"><form class="box form" id="coForm" novalidate>
    <h3>Thông tin nhận hàng</h3>
    <div class="row2"><div><label>Họ và tên *</label><input name="name" required value="${esc(last.name || u.name || '')}"></div><div><label>Số điện thoại *</label><input name="phone" inputmode="tel" required value="${esc(last.phone || u.phone || '')}"></div></div>
    <div><label>Email (nhận xác nhận đơn)</label><input name="email" type="email" value="${esc(last.email || u.email || '')}"></div>
    <div><label>Địa chỉ nhận hàng *</label><input name="address" placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành" required value="${esc(last.address || '')}"></div>
    <div><label>Ghi chú</label><textarea name="note" rows="2" placeholder="Ví dụ: giao giờ hành chính"></textarea></div>
    <h3>Phương thức thanh toán</h3>
    <div class="pay">
      <label><input type="radio" name="payment" value="cod" checked><span>Thanh toán khi nhận hàng (COD)<small>Kiểm tra máy rồi mới thanh toán</small></span></label>
      <label><input type="radio" name="payment" value="bank"><span>Chuyển khoản ngân hàng<small>Thông tin chuyển khoản hiển thị sau khi đặt hàng</small></span></label>
      <label><input type="radio" name="payment" value="installment"><span>Trả góp 0% qua thẻ tín dụng<small>Nhân viên sẽ gọi hỗ trợ làm hồ sơ trong 15 phút</small></span></label>
    </div>
    <div class="err" id="coErr" hidden></div>
    <button class="btn" id="coBtn" type="submit" style="padding:14px;font-size:16px">Đặt hàng · ${fmt(c.total)}</button>
  </form>
  <div class="box"><h3 style="margin-bottom:6px">Đơn hàng (${Cart.count()} sản phẩm)</h3>
    ${c.lines.map(({ p, qty }) => `<div class="sum-row"><span>${esc(p.name)} × ${qty}</span><b>${fmt(p.price * qty)}</b></div>`).join('')}
    <hr style="border:0;border-top:1px solid var(--line)">${couponHTML(c)}${summaryHTML(c)}</div></div>`;
  bindCoupon(checkout);
  $('#coForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target)); const btn = $('#coBtn'); const box = $('#coErr');
    box.hidden = true; btn.disabled = true; btn.textContent = 'Đang xử lý…';
    try {
      const { order } = await api('/orders', { method: 'POST', body: { items: c.lines.map(l => ({ id: l.p.id, qty: l.qty })), customer: { name: fd.name, phone: fd.phone, email: fd.email, address: fd.address, note: fd.note }, payment: fd.payment, coupon: coupon.get() } });
      localStorage.setItem('shipInfo', JSON.stringify({ name: fd.name, phone: fd.phone, email: fd.email, address: fd.address }));
      sessionStorage.setItem('lastOrder', JSON.stringify(order)); Cart.clear(); coupon.clear();
      location.hash = '#/order/' + order.code;
    } catch (ex) { box.textContent = ex.message; box.hidden = false; btn.disabled = false; btn.textContent = 'Đặt hàng · ' + fmt(c.total); box.scrollIntoView({ block: 'center' }); }
  });
}

/* ---------------- Đơn hàng ---------------- */
const FLOW = ['pending', 'processing', 'shipping', 'done'];
const PAYLABEL = { cod: 'Thanh toán khi nhận hàng (COD)', bank: 'Chuyển khoản ngân hàng', installment: 'Trả góp 0% qua thẻ tín dụng' };
function statusLabel(o) { return state.meta.statuses[o.status] || o.status; }
function orderBox(o, withTimeline = true) {
  const idx = FLOW.indexOf(o.status);
  return `<div class="order-box"><header><div><b>Đơn ${esc(o.code)}</b><div style="font-size:12.5px;color:var(--muted)">${esc(o.created_at)}</div></div><span class="tag ${o.status}">${esc(statusLabel(o))}</span></header>
    ${withTimeline ? `<div class="timeline ${o.status === 'cancelled' ? 'cancel' : ''}">${FLOW.map((s, i) => `<div class="st ${i <= idx ? 'on' : ''}">${esc(state.meta.statuses[s])}</div>`).join('')}</div>` : ''}
    <ul style="margin:6px 0;padding-left:18px">${o.items.map(i => `<li>${esc(i.name)} × ${i.qty} — ${fmt(i.price * i.qty)}</li>`).join('')}</ul>
    <div class="sum-row"><span>Tạm tính</span><span>${fmt(o.subtotal)}</span></div>
    ${o.discount ? `<div class="sum-row"><span>Giảm giá (${esc(o.coupon)})</span><span>-${fmt(o.discount)}</span></div>` : ''}
    <div class="sum-row"><span>Vận chuyển</span><span>${o.shipping ? fmt(o.shipping) : 'Miễn phí'}</span></div>
    <div class="sum-row total"><span>Tổng cộng</span><span>${fmt(o.total)}</span></div>
    <div style="font-size:13.5px;color:#4b5563;margin-top:6px">👤 ${esc(o.name)} · ${esc(o.phone)}<br>📍 ${esc(o.address)}<br>💳 ${esc(PAYLABEL[o.payment] || o.payment)}</div></div>`;
}

function orderDone(code) {
  const o = JSON.parse(sessionStorage.getItem('lastOrder') || 'null');
  if (!o || o.code !== code) { app.innerHTML = `<div class="box empty"><p>Để xem lại đơn hàng, vui lòng tra cứu bằng mã đơn và số điện thoại.</p><a class="btn" href="#/lookup">Tra cứu đơn hàng</a></div>`; return; }
  app.innerHTML = `<div class="narrow done"><div class="box"><div class="ok">🎉</div><h1 style="font-size:24px">Đặt hàng thành công!</h1>
    <p style="color:var(--muted)">Mã đơn hàng của bạn: <b style="color:var(--red);font-size:20px">${esc(o.code)}</b><br>Nhân viên sẽ liên hệ xác nhận qua số <b>${esc(o.phone)}</b> trong ít phút.</p>
    ${o.payment === 'bank' ? `<div class="promo" style="text-align:left"><h4>Thông tin chuyển khoản (demo)</h4>Ngân hàng: <b>Vietcombank</b><br>Số tài khoản: <b>0123 456 789</b> — LAPTOPSTORE JSC<br>Số tiền: <b>${fmt(o.total)}</b><br>Nội dung: <b>${esc(o.code)}</b></div>` : ''}
    ${orderBox(o, false)}<a class="btn" href="#/products">Tiếp tục mua sắm</a></div></div>`;
}

function lookup() {
  const saved = JSON.parse(localStorage.getItem('shipInfo') || '{}');
  app.innerHTML = `<div class="narrow"><div class="box"><h1 style="font-size:22px;margin-bottom:10px">Tra cứu đơn hàng</h1>
    <form class="form" id="lkForm"><div><label>Mã đơn hàng</label><input name="code" placeholder="VD: LT2610181234" required></div>
    <div><label>Số điện thoại đặt hàng</label><input name="phone" value="${esc(saved.phone || '')}" required></div>
    <div class="err" id="lkErr" hidden></div><button class="btn" type="submit">Tra cứu</button></form></div><div id="lkRes" style="margin-top:12px"></div></div>`;
  $('#lkForm').addEventListener('submit', async e => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); const er = $('#lkErr'); er.hidden = true; $('#lkRes').innerHTML = '';
    try { const { order } = await api('/orders/lookup?' + new URLSearchParams(fd)); $('#lkRes').innerHTML = orderBox(order); }
    catch (ex) { er.textContent = ex.message; er.hidden = false; }
  });
}

/* ---------------- Tài khoản ---------------- */
async function account() {
  if (state.user) {
    loading();
    const { orders } = await api('/my/orders');
    app.innerHTML = `<div class="narrow"><div class="box"><h1 style="font-size:22px">Xin chào, ${esc(state.user.name)} 👋</h1>
      <p style="color:var(--muted);margin:4px 0 12px">${esc(state.user.email)}${state.user.phone ? ' · ' + esc(state.user.phone) : ''}</p>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="logout">Đăng xuất</button>${state.user.role === 'admin' ? '<a class="btn" href="/admin">Trang quản trị</a>' : ''}</div></div>
      <h2 style="font-size:18px;margin:16px 0 8px">Đơn hàng của tôi</h2>
      ${orders.length ? orders.map(o => orderBox(o)).join('') : '<div class="box empty">Bạn chưa có đơn hàng nào.</div>'}</div>`;
    $('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); state.user = null; renderUser(); toast('Đã đăng xuất'); location.hash = '#/'; };
    return;
  }
  let mode = 'login';
  const draw = () => {
    app.innerHTML = `<div class="narrow"><div class="box"><div class="tabs"><button class="${mode === 'login' ? 'on' : ''}" data-m="login">Đăng nhập</button><button class="${mode === 'register' ? 'on' : ''}" data-m="register">Đăng ký</button></div>
      <form class="form" id="auForm" novalidate>
        ${mode === 'register' ? '<div><label>Họ và tên</label><input name="name" required></div><div><label>Số điện thoại</label><input name="phone"></div>' : ''}
        <div><label>Email</label><input name="email" type="email" required></div>
        <div><label>Mật khẩu</label><input name="password" type="password" required minlength="6" placeholder="Tối thiểu 6 ký tự"></div>
        <div class="err" id="auErr" hidden></div>
        <button class="btn" type="submit">${mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button></form></div></div>`;
    app.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
    $('#auForm').addEventListener('submit', async e => {
      e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
      try { const { user } = await api('/auth/' + mode, { method: 'POST', body: fd }); state.user = user; renderUser(); toast('Xin chào ' + user.name + '!'); account(); }
      catch (ex) { const er = $('#auErr'); er.textContent = ex.message; er.hidden = false; }
    });
  };
  draw();
}

/* ---------------- Router & khởi tạo ---------------- */
const routes = [
  [/^\/?$/, () => home(), 'LaptopStore - Laptop chính hãng, giá tốt'],
  [/^\/products(?:\?(.*))?$/, q => products(q), 'Danh sách laptop | LaptopStore'],
  [/^\/product\/(\d+)$/, id => detail(id), 'Chi tiết sản phẩm | LaptopStore'],
  [/^\/cart$/, () => cart(), 'Giỏ hàng | LaptopStore'],
  [/^\/checkout$/, () => checkout(), 'Thanh toán | LaptopStore'],
  [/^\/order\/(\w+)$/, c => orderDone(c), 'Đặt hàng thành công | LaptopStore'],
  [/^\/lookup$/, () => lookup(), 'Tra cứu đơn hàng | LaptopStore'],
  [/^\/account$/, () => account(), 'Tài khoản | LaptopStore'],
];
async function route() {
  state.timers.forEach(clearInterval); state.timers = [];
  closeMega();
  const path = decodeURI(location.hash.replace(/^#/, '')) || '/';
  for (const [re, fn, title] of routes) {
    const m = path.match(re);
    if (m) {
      document.title = title; window.scrollTo(0, 0);
      try { await fn(m[1]); } catch (e) { fail(e); }
      highlightNav(path);
      return;
    }
  }
  fail(new Error('Không tìm thấy trang'));
}

function highlightNav(path) {
  document.querySelectorAll('#navInner a').forEach(a => a.classList.toggle('on', decodeURI(a.getAttribute('href').slice(1)) === path));
}
function renderUser() { $('#userLabel').innerHTML = state.user ? esc(state.user.name.split(' ').pop()) + '<br>của tôi' : 'Đăng<br>nhập'; }

/* Mega menu */
function closeMega() { $('#mega')?.remove(); }
$('#menuBtn').addEventListener('click', e => {
  e.stopPropagation();
  if ($('#mega')) return closeMega();
  const m = document.createElement('div'); m.id = 'mega'; m.className = 'mega'; m.style.top = '100%';
  m.innerHTML = `<div class="wrap"><div><h4>Hãng laptop</h4>${state.meta.brands.map(b => `<a href="#/products?brand=${encodeURIComponent(b.name)}">${esc(b.name)}</a>`).join('')}</div>
    <div><h4>Nhu cầu sử dụng</h4>${state.meta.categories.map(c => `<a href="#/products?category=${encodeURIComponent(c.name)}">${esc(c.name)}</a>`).join('')}</div>
    <div><h4>Mức giá</h4>${PRICE_RANGES.slice(1).map(([v, l]) => `<a href="#/products?price=${v}">${l}</a>`).join('')}</div></div>`;
  $('.header').appendChild(m);
});
document.addEventListener('click', e => { if (!e.target.closest('#mega') && !e.target.closest('#menuBtn')) closeMega(); if (!e.target.closest('.search')) $('#suggest').hidden = true; });

/* Tìm kiếm + gợi ý */
let sgTimer;
$('#searchInput').addEventListener('input', e => {
  clearTimeout(sgTimer); const v = e.target.value.trim(); const box = $('#suggest');
  if (v.length < 2) { box.hidden = true; return; }
  sgTimer = setTimeout(async () => {
    try {
      const { items } = await api('/products?limit=5&q=' + encodeURIComponent(v));
      box.innerHTML = items.length ? items.map(p => `<a href="#/product/${p.id}"><img src="${laptopSVG(p)}" alt=""><span class="n">${esc(p.name)}</span><span class="p">${fmt(p.price)}</span></a>`).join('') : '<div class="none">Không có gợi ý phù hợp</div>';
      box.hidden = false;
    } catch { }
  }, 250);
});
$('#suggest').addEventListener('click', () => { $('#suggest').hidden = true; });
$('#searchForm').addEventListener('submit', e => {
  e.preventDefault(); const v = $('#searchInput').value.trim(); $('#suggest').hidden = true;
  location.hash = v ? '#/products?q=' + encodeURIComponent(v) : '#/products';
});

/* Thêm vào giỏ từ thẻ sản phẩm */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  Cart.add(+b.dataset.add, 1, +b.dataset.stock || 10); toast('Đã thêm vào giỏ hàng ✓');
});

window.addEventListener('hashchange', route);
(async function init() {
  Cart.badge();
  try {
    const [meta, me] = await Promise.all([api('/meta'), api('/auth/me')]);
    state.meta = meta; state.user = me.user; renderUser();
    $('#navInner').innerHTML = `<a href="#/products">Tất cả</a>` + meta.categories.map(c => `<a href="#/products?category=${encodeURIComponent(c.name)}">${esc(c.name)}</a>`).join('') + meta.brands.map(b => `<a href="#/products?brand=${encodeURIComponent(b.name)}">${esc(b.name)}</a>`).join('');
    route();
  } catch (e) { fail(e); }
})();
