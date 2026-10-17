"""LaptopStore - back-end (Flask + SQLite).

Chạy:  pip install -r requirements.txt  &&  python app.py
Mở:    http://localhost:5000        (cửa hàng)
       http://localhost:5000/admin  (quản trị: admin@laptopstore.vn / admin123)
"""
import os
import random
import re
import sqlite3
import unicodedata
from datetime import datetime
from functools import wraps

from flask import Flask, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "store.db")

app = Flask(__name__, static_folder=os.path.join(BASE, "static"), static_url_path="")
app.secret_key = os.environ.get("SECRET_KEY", "dev-only-secret-change-me")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")

FREE_SHIP_FROM = 5_000_000
SHIP_FEE = 30_000
STATUSES = {
    "pending": "Chờ xác nhận",
    "processing": "Đang xử lý",
    "shipping": "Đang giao hàng",
    "done": "Hoàn thành",
    "cancelled": "Đã hủy",
}
COUPONS = {
    "WELCOME": {"type": "percent", "value": 5, "max": 500_000, "min": 5_000_000,
                "desc": "Giảm 5% (tối đa 500.000₫) cho đơn từ 5 triệu"},
    "SINHVIEN": {"type": "fixed", "value": 300_000, "min": 8_000_000,
                 "desc": "Giảm 300.000₫ cho đơn từ 8 triệu"},
    "GAMING500": {"type": "fixed", "value": 500_000, "min": 20_000_000,
                  "desc": "Giảm 500.000₫ cho đơn từ 20 triệu"},
}

# --------------------------------------------------------------------------- #
#  Database
# --------------------------------------------------------------------------- #
SCHEMA = """
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, brand TEXT NOT NULL, category TEXT NOT NULL,
  price INTEGER NOT NULL, old_price INTEGER NOT NULL DEFAULT 0,
  cpu TEXT DEFAULT '', ram TEXT DEFAULT '', storage TEXT DEFAULT '', gpu TEXT DEFAULT '',
  screen TEXT DEFAULT '', weight REAL DEFAULT 0, os TEXT DEFAULT '', battery TEXT DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0, sold INTEGER NOT NULL DEFAULT 0, rating REAL DEFAULT 4.5,
  description TEXT DEFAULT '', featured INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  search_text TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL, user_id INTEGER,
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT DEFAULT '', address TEXT NOT NULL,
  note TEXT DEFAULT '', payment TEXT NOT NULL, coupon TEXT DEFAULT '',
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0,
  shipping INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, name TEXT NOT NULL, brand TEXT DEFAULT '',
  price INTEGER NOT NULL, qty INTEGER NOT NULL
);
"""

# name, brand, category, price, old_price, cpu, ram, storage, gpu, screen, weight, battery, stock, sold, rating, featured
SEED = [
    ("ASUS Vivobook 15 X1504ZA", "ASUS", "Văn phòng", 13990000, 16490000, "Intel Core i5-1235U", "16GB DDR4", "512GB SSD NVMe", "Intel Iris Xe", '15.6" FHD IPS 60Hz', 1.7, "42Wh", 25, 320, 4.6, 1),
    ("ASUS TUF Gaming F15 FX507ZC4", "ASUS", "Gaming", 19990000, 24990000, "Intel Core i5-12500H", "16GB DDR4", "512GB SSD NVMe", "RTX 3050 4GB", '15.6" FHD IPS 144Hz', 2.2, "48Wh", 18, 410, 4.7, 1),
    ("ASUS ROG Strix G16 G614JV", "ASUS", "Gaming", 34990000, 39990000, "Intel Core i7-13650HX", "16GB DDR5", "1TB SSD NVMe", "RTX 4060 8GB", '16" QHD+ IPS 165Hz', 2.5, "90Wh", 8, 120, 4.8, 1),
    ("ASUS Zenbook 14 OLED UX3405MA", "ASUS", "Mỏng nhẹ", 29990000, 33990000, "Intel Core Ultra 7 155H", "32GB LPDDR5X", "1TB SSD NVMe", "Intel Arc Graphics", '14" 3K OLED 120Hz', 1.2, "75Wh", 10, 85, 4.8, 1),
    ("Acer Aspire 5 A515-58P", "Acer", "Sinh viên", 14490000, 16990000, "Intel Core i5-1335U", "16GB DDR4", "512GB SSD NVMe", "Intel Iris Xe", '15.6" FHD IPS 60Hz', 1.8, "50Wh", 30, 560, 4.5, 0),
    ("Acer Nitro V 15 ANV15-51", "Acer", "Gaming", 21990000, 25990000, "Intel Core i5-13420H", "16GB DDR5", "512GB SSD NVMe", "RTX 4050 6GB", '15.6" FHD IPS 144Hz', 2.1, "57Wh", 14, 380, 4.7, 1),
    ("Acer Swift Go 14 SFG14-73", "Acer", "Mỏng nhẹ", 19990000, 23990000, "Intel Core Ultra 5 125H", "16GB LPDDR5X", "512GB SSD NVMe", "Intel Arc Graphics", '14" 2.8K OLED 90Hz', 1.3, "65Wh", 12, 140, 4.6, 0),
    ("Acer Predator Helios Neo 16", "Acer", "Gaming", 38990000, 44990000, "Intel Core i7-14700HX", "16GB DDR5", "1TB SSD NVMe", "RTX 4060 8GB", '16" WQXGA IPS 165Hz', 2.6, "90Wh", 6, 64, 4.8, 0),
    ("Lenovo IdeaPad Slim 3 15IAH8", "Lenovo", "Sinh viên", 13490000, 15990000, "Intel Core i5-12450H", "16GB DDR4", "512GB SSD NVMe", "Intel UHD Graphics", '15.6" FHD IPS 60Hz', 1.6, "47Wh", 40, 690, 4.5, 1),
    ("Lenovo LOQ 15IRX9", "Lenovo", "Gaming", 22990000, 26990000, "Intel Core i5-13450HX", "16GB DDR5", "512GB SSD NVMe", "RTX 4050 6GB", '15.6" FHD IPS 144Hz', 2.4, "60Wh", 16, 300, 4.7, 1),
    ("Lenovo Legion 5 15IRX10", "Lenovo", "Gaming", 36990000, 41990000, "Intel Core i7-14650HX", "16GB DDR5", "1TB SSD NVMe", "RTX 4060 8GB", '15.1" WQXGA IPS 165Hz', 2.4, "80Wh", 7, 98, 4.8, 0),
    ("Lenovo ThinkPad E14 Gen 5", "Lenovo", "Văn phòng", 18990000, 22990000, "Intel Core i5-1335U", "16GB DDR4", "512GB SSD NVMe", "Intel Iris Xe", '14" WUXGA IPS 60Hz', 1.4, "47Wh", 20, 210, 4.6, 0),
    ("Lenovo Yoga Slim 7 Ultra 14", "Lenovo", "Mỏng nhẹ", 31990000, 35990000, "Intel Core Ultra 7 155H", "32GB LPDDR5X", "1TB SSD NVMe", "Intel Arc Graphics", '14" 3K OLED 120Hz', 1.3, "70Wh", 5, 40, 4.7, 0),
    ("HP 15s-fq5xxx", "HP", "Sinh viên", 12490000, 14490000, "Intel Core i5-1235U", "8GB DDR4", "512GB SSD NVMe", "Intel Iris Xe", '15.6" FHD IPS 60Hz', 1.7, "41Wh", 35, 740, 4.4, 0),
    ("HP Pavilion 14-eh1xxx", "HP", "Văn phòng", 16990000, 19990000, "Intel Core i5-1335U", "16GB DDR4", "512GB SSD NVMe", "Intel Iris Xe", '14" FHD IPS 60Hz', 1.4, "43Wh", 22, 260, 4.6, 0),
    ("HP Victus 15-fa1xxx", "HP", "Gaming", 20490000, 23990000, "Intel Core i5-13420H", "16GB DDR4", "512GB SSD NVMe", "RTX 3050 6GB", '15.6" FHD IPS 144Hz', 2.3, "70Wh", 15, 350, 4.6, 0),
    ("HP Omen 16-wf0xxx", "HP", "Gaming", 37990000, 43990000, "Intel Core i7-13700HX", "16GB DDR5", "1TB SSD NVMe", "RTX 4060 8GB", '16.1" QHD IPS 165Hz', 2.4, "83Wh", 6, 55, 4.7, 0),
    ("HP EliteBook 840 G10", "HP", "Văn phòng", 35990000, 41990000, "Intel Core i7-1355U", "32GB DDR5", "1TB SSD NVMe", "Intel Iris Xe", '14" WUXGA IPS 60Hz', 1.4, "51Wh", 9, 33, 4.7, 0),
    ("Dell Inspiron 15 3520", "Dell", "Sinh viên", 13290000, 15490000, "Intel Core i5-1235U", "8GB DDR4", "512GB SSD NVMe", "Intel Iris Xe", '15.6" FHD WVA 120Hz', 1.9, "41Wh", 28, 480, 4.4, 0),
    ("Dell Latitude 3440", "Dell", "Văn phòng", 17990000, 20990000, "Intel Core i5-1335U", "16GB DDR4", "512GB SSD NVMe", "Intel Iris Xe", '14" FHD IPS 60Hz', 1.5, "54Wh", 18, 150, 4.5, 0),
    ("Dell G15 5530", "Dell", "Gaming", 31990000, 36990000, "Intel Core i7-13650HX", "16GB DDR5", "512GB SSD NVMe", "RTX 4060 8GB", '15.6" FHD WVA 165Hz', 2.8, "86Wh", 8, 92, 4.6, 0),
    ("Dell XPS 13 9340", "Dell", "Mỏng nhẹ", 42990000, 47990000, "Intel Core Ultra 7 155H", "32GB LPDDR5X", "1TB SSD NVMe", "Intel Arc Graphics", '13.4" FHD+ InfinityEdge', 1.2, "54Wh", 4, 22, 4.8, 0),
    ("MacBook Air 13 M2 2022", "Apple", "Mỏng nhẹ", 19990000, 24990000, "Apple M2 8 nhân", "8GB Unified", "256GB SSD", "GPU 8 nhân", '13.6" Liquid Retina', 1.24, "52.6Wh", 20, 910, 4.9, 1),
    ("MacBook Air 13 M3 2024", "Apple", "Mỏng nhẹ", 28990000, 32990000, "Apple M3 8 nhân", "16GB Unified", "512GB SSD", "GPU 10 nhân", '13.6" Liquid Retina', 1.24, "52.6Wh", 14, 430, 4.9, 1),
    ("MacBook Pro 14 M3 Pro", "Apple", "Đồ họa", 44990000, 49990000, "Apple M3 Pro 11 nhân", "18GB Unified", "512GB SSD", "GPU 14 nhân", '14.2" Liquid Retina XDR', 1.6, "70Wh", 6, 120, 4.9, 1),
    ("MSI Modern 14 C13M", "MSI", "Văn phòng", 14990000, 17990000, "Intel Core i5-1334U", "16GB DDR4", "512GB SSD NVMe", "Intel Iris Xe", '14" FHD IPS 60Hz', 1.4, "39Wh", 24, 180, 4.4, 0),
    ("MSI Thin GF63 12UC", "MSI", "Gaming", 17990000, 21990000, "Intel Core i5-12450H", "16GB DDR4", "512GB SSD NVMe", "RTX 3050 4GB", '15.6" FHD IPS 144Hz', 1.9, "52Wh", 17, 520, 4.5, 0),
    ("MSI Katana 15 B13VFK", "MSI", "Gaming", 28990000, 33990000, "Intel Core i7-13620H", "16GB DDR5", "1TB SSD NVMe", "RTX 4060 8GB", '15.6" FHD IPS 144Hz', 2.25, "53Wh", 9, 140, 4.7, 0),
    ("ASUS ProArt P16 H7606", "ASUS", "Đồ họa", 52990000, 58990000, "AMD Ryzen AI 9 HX 370", "32GB LPDDR5X", "1TB SSD NVMe", "RTX 4060 8GB", '16" 4K OLED 120Hz', 1.85, "90Wh", 3, 18, 4.8, 0),
]


def unaccent(s):
    s = (s or "").replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def make_search_text(p):
    return unaccent(" ".join(str(p.get(k, "")) for k in ("name", "brand", "category", "cpu", "gpu", "ram")))


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    if con.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
        for t in SEED:
            keys = ("name brand category price old_price cpu ram storage gpu screen weight battery "
                    "stock sold rating featured").split()
            p = dict(zip(keys, t))
            p["os"] = "macOS" if p["brand"] == "Apple" else "Windows 11 Home"
            p["description"] = (
                f"{p['name']} trang bị {p['cpu']}, RAM {p['ram']}, ổ cứng {p['storage']} và card đồ họa "
                f"{p['gpu']}. Màn hình {p['screen']}, trọng lượng {p['weight']} kg, pin {p['battery']}. "
                f"Máy thuộc dòng {p['category'].lower()}, phù hợp cho nhu cầu học tập, làm việc và giải trí hằng ngày."
            )
            p["search_text"] = make_search_text(p)
            cols = ",".join(p)
            con.execute(f"INSERT INTO products({cols}) VALUES({','.join('?' * len(p))})", list(p.values()))
    if con.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0] == 0:
        con.execute("INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,?)",
                    ("Quản trị viên", "admin@laptopstore.vn", "0900000000",
                     generate_password_hash("admin123"), "admin"))
    con.commit()
    con.close()


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    d = g.pop("db", None)
    if d is not None:
        d.close()


def rows(sql, args=()):
    return [dict(r) for r in db().execute(sql, args).fetchall()]


def one(sql, args=()):
    r = db().execute(sql, args).fetchone()
    return dict(r) if r else None


def err(msg, code=400):
    return jsonify(error=msg), code


def prod(r):
    r = dict(r)
    r.pop("search_text", None)
    r["discount"] = round((1 - r["price"] / r["old_price"]) * 100) if r["old_price"] > r["price"] else 0
    return r


# --------------------------------------------------------------------------- #
#  Auth helpers
# --------------------------------------------------------------------------- #
def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    return one("SELECT id,name,email,phone,role FROM users WHERE id=?", (uid,))


def login_required(f):
    @wraps(f)
    def w(*a, **k):
        if not current_user():
            return err("Vui lòng đăng nhập", 401)
        return f(*a, **k)
    return w


def admin_required(f):
    @wraps(f)
    def w(*a, **k):
        u = current_user()
        if not u or u["role"] != "admin":
            return err("Không có quyền truy cập", 403)
        return f(*a, **k)
    return w


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^(0|\+84)\d{9}$")


def norm_phone(p):
    return re.sub(r"[\s.\-]", "", p or "")


# --------------------------------------------------------------------------- #
#  Pages
# --------------------------------------------------------------------------- #
@app.get("/")
def home():
    return app.send_static_file("index.html")


@app.get("/admin")
def admin_page():
    return app.send_static_file("admin.html")


# --------------------------------------------------------------------------- #
#  Products
# --------------------------------------------------------------------------- #
SORTS = {
    "popular": "sold DESC, id DESC",
    "price_asc": "price ASC",
    "price_desc": "price DESC",
    "newest": "id DESC",
    "discount": "(CAST(old_price-price AS REAL)/NULLIF(old_price,0)) DESC, sold DESC",
}


def csv_arg(name):
    return [x for x in request.args.get(name, "").split(",") if x]


def in_clause(col, vals, where, args):
    where.append(f"{col} IN ({','.join('?' * len(vals))})")
    args.extend(vals)


@app.get("/api/products")
def list_products():
    a = request.args
    where, args = ["active=1"], []
    if a.get("ids"):
        ids = [int(x) for x in a["ids"].split(",") if x.isdigit()]
        if not ids:
            return jsonify(items=[], total=0, page=1, pages=1)
        in_clause("id", ids, where, args)
    for w in unaccent(a.get("q", "")).split():
        where.append("search_text LIKE ?")
        args.append(f"%{w}%")
    if csv_arg("brand"):
        in_clause("brand", csv_arg("brand"), where, args)
    if csv_arg("category"):
        in_clause("category", csv_arg("category"), where, args)
    if csv_arg("ram"):
        rs = csv_arg("ram")
        where.append("(" + " OR ".join("ram LIKE ?" for _ in rs) + ")")
        args += [f"{r}%" for r in rs]
    if a.get("price_min", "").isdigit():
        where.append("price >= ?")
        args.append(int(a["price_min"]))
    if a.get("price_max", "").isdigit():
        where.append("price <= ?")
        args.append(int(a["price_max"]))
    if a.get("featured") == "1":
        where.append("featured=1")
    order = SORTS.get(a.get("sort", "popular"), SORTS["popular"])
    try:
        limit = max(1, min(int(a.get("limit", 12)), 60))
        page = max(1, int(a.get("page", 1)))
    except ValueError:
        return err("Tham số không hợp lệ")
    cond = " AND ".join(where)
    total = db().execute(f"SELECT COUNT(*) FROM products WHERE {cond}", args).fetchone()[0]
    items = rows(f"SELECT * FROM products WHERE {cond} ORDER BY {order} LIMIT ? OFFSET ?",
                 args + [limit, (page - 1) * limit])
    return jsonify(items=[prod(i) for i in items], total=total, page=page,
                   pages=max(1, -(-total // limit)))


@app.get("/api/products/<int:pid>")
def get_product(pid):
    p = one("SELECT * FROM products WHERE id=? AND active=1", (pid,))
    if not p:
        return err("Không tìm thấy sản phẩm", 404)
    related = rows("SELECT * FROM products WHERE active=1 AND id!=? AND (category=? OR brand=?) "
                   "ORDER BY (category=?) DESC, sold DESC LIMIT 5", (pid, p["category"], p["brand"], p["category"]))
    return jsonify(product=prod(p), related=[prod(r) for r in related])


@app.get("/api/meta")
def meta():
    return jsonify(
        brands=rows("SELECT brand AS name, COUNT(*) AS n FROM products WHERE active=1 GROUP BY brand ORDER BY n DESC"),
        categories=rows("SELECT category AS name, COUNT(*) AS n FROM products WHERE active=1 GROUP BY category ORDER BY n DESC"),
        statuses=STATUSES,
        coupons=[{"code": k, "desc": v["desc"]} for k, v in COUPONS.items()],
        free_ship_from=FREE_SHIP_FROM, ship_fee=SHIP_FEE,
    )


# --------------------------------------------------------------------------- #
#  Auth
# --------------------------------------------------------------------------- #
@app.post("/api/auth/register")
def register():
    d = request.get_json(silent=True) or {}
    name, email, pw = (d.get("name") or "").strip(), (d.get("email") or "").strip().lower(), d.get("password") or ""
    phone = norm_phone(d.get("phone"))
    if len(name) < 2:
        return err("Vui lòng nhập họ tên")
    if not EMAIL_RE.match(email):
        return err("Email không hợp lệ")
    if phone and not PHONE_RE.match(phone):
        return err("Số điện thoại không hợp lệ")
    if len(pw) < 6:
        return err("Mật khẩu tối thiểu 6 ký tự")
    if one("SELECT id FROM users WHERE email=?", (email,)):
        return err("Email đã được đăng ký", 409)
    cur = db().execute("INSERT INTO users(name,email,phone,password_hash) VALUES(?,?,?,?)",
                       (name, email, phone, generate_password_hash(pw)))
    db().commit()
    session["uid"] = cur.lastrowid
    return jsonify(user=current_user())


@app.post("/api/auth/login")
def login():
    d = request.get_json(silent=True) or {}
    u = one("SELECT * FROM users WHERE email=?", ((d.get("email") or "").strip().lower(),))
    if not u or not check_password_hash(u["password_hash"], d.get("password") or ""):
        return err("Email hoặc mật khẩu không đúng", 401)
    session["uid"] = u["id"]
    return jsonify(user=current_user())


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/auth/me")
def me():
    return jsonify(user=current_user())


# --------------------------------------------------------------------------- #
#  Coupons & orders
# --------------------------------------------------------------------------- #
def calc_discount(code, subtotal):
    """Trả về (discount, message_lỗi)."""
    if not code:
        return 0, None
    c = COUPONS.get(code.strip().upper())
    if not c:
        return 0, "Mã giảm giá không tồn tại"
    if subtotal < c["min"]:
        return 0, f"Mã chỉ áp dụng cho đơn từ {c['min']:,}₫".replace(",", ".")
    d = subtotal * c["value"] // 100 if c["type"] == "percent" else c["value"]
    if c.get("max"):
        d = min(d, c["max"])
    return min(d, subtotal), None


def shipping_for(subtotal):
    return 0 if subtotal >= FREE_SHIP_FROM or subtotal == 0 else SHIP_FEE


@app.post("/api/coupon/check")
def coupon_check():
    d = request.get_json(silent=True) or {}
    code = (d.get("code") or "").strip().upper()
    subtotal = int(d.get("subtotal") or 0)
    disc, e = calc_discount(code, subtotal)
    if e:
        return err(e)
    return jsonify(code=code, discount=disc, desc=COUPONS[code]["desc"])


def order_with_items(o):
    o["items"] = rows("SELECT * FROM order_items WHERE order_id=?", (o["id"],))
    o["status_label"] = STATUSES.get(o["status"], o["status"])
    return o


@app.post("/api/orders")
def create_order():
    d = request.get_json(silent=True) or {}
    c = d.get("customer") or {}
    name, address = (c.get("name") or "").strip(), (c.get("address") or "").strip()
    phone, email = norm_phone(c.get("phone")), (c.get("email") or "").strip()
    payment = d.get("payment") or "cod"
    if len(name) < 2:
        return err("Vui lòng nhập họ tên")
    if not PHONE_RE.match(phone):
        return err("Số điện thoại không hợp lệ")
    if email and not EMAIL_RE.match(email):
        return err("Email không hợp lệ")
    if len(address) < 8:
        return err("Vui lòng nhập địa chỉ nhận hàng đầy đủ")
    if payment not in ("cod", "bank", "installment"):
        return err("Phương thức thanh toán không hợp lệ")
    items = d.get("items") or []
    if not items:
        return err("Giỏ hàng trống")

    con = db()
    lines, subtotal = [], 0
    try:
        con.execute("BEGIN IMMEDIATE")
        for it in items:
            try:
                pid, qty = int(it["id"]), int(it["qty"])
            except (KeyError, ValueError, TypeError):
                raise ValueError("Dữ liệu giỏ hàng không hợp lệ")
            if qty < 1 or qty > 10:
                raise ValueError("Số lượng mỗi sản phẩm từ 1 đến 10")
            p = one("SELECT * FROM products WHERE id=? AND active=1", (pid,))
            if not p:
                raise ValueError("Có sản phẩm không còn kinh doanh")
            if p["stock"] < qty:
                raise ValueError(f"'{p['name']}' chỉ còn {p['stock']} sản phẩm")
            lines.append((p, qty))
            subtotal += p["price"] * qty
        coupon = (d.get("coupon") or "").strip().upper()
        discount, e = calc_discount(coupon, subtotal)
        if e:
            raise ValueError(e)
        ship = shipping_for(subtotal)
        total = subtotal - discount + ship
        while True:
            code = "LT" + datetime.now().strftime("%y%m%d") + str(random.randint(1000, 9999))
            if not con.execute("SELECT 1 FROM orders WHERE code=?", (code,)).fetchone():
                break
        u = current_user()
        cur = con.execute(
            "INSERT INTO orders(code,user_id,name,phone,email,address,note,payment,coupon,subtotal,discount,shipping,total,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (code, u["id"] if u else None, name, phone, email, address, (c.get("note") or "")[:500], payment,
             coupon if discount else "", subtotal, discount, ship, total,
             datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        oid = cur.lastrowid
        for p, qty in lines:
            con.execute("INSERT INTO order_items(order_id,product_id,name,brand,price,qty) VALUES(?,?,?,?,?,?)",
                        (oid, p["id"], p["name"], p["brand"], p["price"], qty))
            con.execute("UPDATE products SET stock=stock-? WHERE id=?", (qty, p["id"]))
        con.commit()
    except ValueError as ex:
        con.rollback()
        return err(str(ex))
    except Exception:
        con.rollback()
        raise
    return jsonify(order=order_with_items(one("SELECT * FROM orders WHERE id=?", (oid,)))), 201


@app.get("/api/orders/lookup")
def lookup_order():
    code = (request.args.get("code") or "").strip().upper()
    phone = norm_phone(request.args.get("phone"))
    o = one("SELECT * FROM orders WHERE code=? AND phone=?", (code, phone))
    if not o:
        return err("Không tìm thấy đơn hàng. Kiểm tra lại mã đơn và số điện thoại.", 404)
    return jsonify(order=order_with_items(o))


@app.get("/api/my/orders")
@login_required
def my_orders():
    os_ = rows("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC", (session["uid"],))
    return jsonify(orders=[order_with_items(o) for o in os_])


# --------------------------------------------------------------------------- #
#  Admin
# --------------------------------------------------------------------------- #
FIELDS = ["name", "brand", "category", "price", "old_price", "cpu", "ram", "storage", "gpu", "screen",
          "weight", "os", "battery", "stock", "description", "featured", "active"]
INT_FIELDS = {"price", "old_price", "stock", "featured", "active"}


def clean_product(d):
    out = {}
    for k in FIELDS:
        if k not in d:
            continue
        v = d[k]
        if k in INT_FIELDS:
            try:
                v = int(v or 0)
            except (ValueError, TypeError):
                raise ValueError(f"Trường '{k}' phải là số")
            if v < 0:
                raise ValueError(f"Trường '{k}' không được âm")
        elif k == "weight":
            try:
                v = float(v or 0)
            except (ValueError, TypeError):
                raise ValueError("Trọng lượng phải là số")
        else:
            v = str(v or "").strip()
        out[k] = v
    return out


@app.get("/api/admin/stats")
@admin_required
def admin_stats():
    ok = "status != 'cancelled'"
    revenue = db().execute(f"SELECT COALESCE(SUM(total),0) FROM orders WHERE {ok}").fetchone()[0]
    return jsonify(
        revenue=revenue,
        orders=db().execute("SELECT COUNT(*) FROM orders").fetchone()[0],
        pending=db().execute("SELECT COUNT(*) FROM orders WHERE status='pending'").fetchone()[0],
        products=db().execute("SELECT COUNT(*) FROM products WHERE active=1").fetchone()[0],
        customers=db().execute("SELECT COUNT(*) FROM users WHERE role='customer'").fetchone()[0],
        daily=rows(f"SELECT substr(created_at,1,10) AS day, SUM(total) AS revenue, COUNT(*) AS n FROM orders "
                   f"WHERE {ok} GROUP BY day ORDER BY day DESC LIMIT 7")[::-1],
        low_stock=rows("SELECT id,name,stock FROM products WHERE active=1 AND stock<=5 ORDER BY stock LIMIT 8"),
        top=rows("SELECT product_id AS id, name, SUM(qty) AS qty FROM order_items GROUP BY product_id "
                 "ORDER BY qty DESC LIMIT 5"),
    )


@app.get("/api/admin/products")
@admin_required
def admin_products():
    q = unaccent(request.args.get("q", ""))
    items = rows("SELECT * FROM products WHERE search_text LIKE ? ORDER BY id DESC", (f"%{q}%",))
    return jsonify(items=[prod(i) for i in items])


@app.post("/api/admin/products")
@admin_required
def admin_create_product():
    try:
        p = clean_product(request.get_json(silent=True) or {})
    except ValueError as e:
        return err(str(e))
    if not p.get("name") or not p.get("brand") or p.get("price", 0) <= 0:
        return err("Cần nhập tên, hãng và giá bán (> 0)")
    p.setdefault("category", "Văn phòng")
    p.setdefault("active", 1)
    p["search_text"] = make_search_text(p)
    cur = db().execute(f"INSERT INTO products({','.join(p)}) VALUES({','.join('?' * len(p))})", list(p.values()))
    db().commit()
    return jsonify(product=prod(one("SELECT * FROM products WHERE id=?", (cur.lastrowid,)))), 201


@app.put("/api/admin/products/<int:pid>")
@admin_required
def admin_update_product(pid):
    old = one("SELECT * FROM products WHERE id=?", (pid,))
    if not old:
        return err("Không tìm thấy sản phẩm", 404)
    try:
        p = clean_product(request.get_json(silent=True) or {})
    except ValueError as e:
        return err(str(e))
    if not p:
        return err("Không có dữ liệu cập nhật")
    merged = {**old, **p}
    if not merged["name"] or merged["price"] <= 0:
        return err("Tên và giá bán không hợp lệ")
    p["search_text"] = make_search_text(merged)
    db().execute(f"UPDATE products SET {','.join(k + '=?' for k in p)} WHERE id=?", list(p.values()) + [pid])
    db().commit()
    return jsonify(product=prod(one("SELECT * FROM products WHERE id=?", (pid,))))


@app.delete("/api/admin/products/<int:pid>")
@admin_required
def admin_delete_product(pid):
    # Ẩn thay vì xoá cứng để giữ lịch sử đơn hàng.
    db().execute("UPDATE products SET active=0 WHERE id=?", (pid,))
    db().commit()
    return jsonify(ok=True)


@app.get("/api/admin/orders")
@admin_required
def admin_orders():
    st = request.args.get("status")
    if st:
        os_ = rows("SELECT * FROM orders WHERE status=? ORDER BY id DESC", (st,))
    else:
        os_ = rows("SELECT * FROM orders ORDER BY id DESC")
    return jsonify(orders=[order_with_items(o) for o in os_])


@app.put("/api/admin/orders/<int:oid>/status")
@admin_required
def admin_order_status(oid):
    new = (request.get_json(silent=True) or {}).get("status")
    if new not in STATUSES:
        return err("Trạng thái không hợp lệ")
    o = one("SELECT * FROM orders WHERE id=?", (oid,))
    if not o:
        return err("Không tìm thấy đơn hàng", 404)
    if o["status"] == new:
        return jsonify(order=order_with_items(o))
    if o["status"] == "cancelled":
        return err("Đơn đã hủy không thể mở lại")
    con = db()
    items = rows("SELECT product_id, qty FROM order_items WHERE order_id=?", (oid,))
    if new == "cancelled":  # hoàn kho
        for it in items:
            con.execute("UPDATE products SET stock=stock+? WHERE id=?", (it["qty"], it["product_id"]))
    if new == "done" and o["status"] != "done":  # tính số lượng đã bán
        for it in items:
            con.execute("UPDATE products SET sold=sold+? WHERE id=?", (it["qty"], it["product_id"]))
    con.execute("UPDATE orders SET status=? WHERE id=?", (new, oid))
    con.commit()
    return jsonify(order=order_with_items(one("SELECT * FROM orders WHERE id=?", (oid,))))


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
