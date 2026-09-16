/**
 * Chụp bộ ảnh THẬT của Seller Portal cho trang hướng dẫn lên đơn công khai
 * (`apps/web/public/guide/order/`) và sinh `manifest.json` kèm toạ độ chú thích.
 *
 * Vì sao có file này (11/09/2026, TASK-01): trang hướng dẫn khách lên đơn cần ảnh
 * chụp màn hình thật từng bước. Ảnh chụp tay thì lệch ngay khi UI đổi và toạ độ
 * chú thích ước bằng mắt sẽ trỏ sai chỗ. Script này đi đúng 3 luồng như khách
 * thật (tạo đơn trên form · đẩy sản xuất + theo dõi · import CSV), chụp đè theo
 * tên cố định, và lấy `xPct/yPct` của mỗi chú thích từ boundingBox thật của phần
 * tử (tính tương đối vùng clip) — không ước lượng.
 *
 * DỮ LIỆU: mọi đơn trong ảnh do script tự tạo bằng tài khoản demo với dữ liệu giả
 * (John Smith, 123 Demo Street…). Ảnh design/mockup là SVG giả do chính script
 * phục vụ ở `GUIDE_ASSET_PORT` trong lúc chạy. Ô URL trong ảnh được thay HIỂN THỊ
 * bằng link Drive mẫu ngay trước khi chụp (dữ liệu gửi đi không đổi). KHÔNG BAO
 * GIỜ chạy vào production: script TẠO đơn và ĐẨY sản xuất thật.
 *
 * Chạy lại khi UI đổi (cần API :3007 + seller :3017 đang chạy, DB local):
 *   PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core/index.mjs \
 *     node apps/seller/scripts/capture-order-guide.mjs
 * Rồi mở lại vài ảnh để soát (không trắng, không kẹt spinner, chú thích đúng chỗ).
 * Selector bám theo chữ tiếng Việt của UI — đổi i18n thì sửa selector ở đây.
 *
 * Env: GUIDE_BASE (mặc định http://127.0.0.1:3017), GUIDE_SELLER_EMAIL,
 *      GUIDE_SELLER_PASSWORD, GUIDE_LINE (mặc định 2d — dòng có sản phẩm ở DB local),
 *      GUIDE_PRODUCT (chuỗi con tên sản phẩm cần chọn), GUIDE_OUT (thư mục ảnh),
 *      GUIDE_ASSET_PORT (mặc định 3099), GUIDE_CHANNEL (mặc định chrome — dùng
 *      Chrome đã cài, không tải trình duyệt Playwright), GUIDE_QUALITY (0-1, mặc định 0.82),
 *      PLAYWRIGHT_PATH.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `import` không nhận biểu thức — nạp động để đường dẫn Playwright đặt được qua env.
const pw = process.env.PLAYWRIGHT_PATH;
const { chromium } = await import(pw ? pathToFileURL(pw).href : 'playwright-core');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.GUIDE_BASE || 'http://127.0.0.1:3017').replace(/\/$/, '');
const SELLER = { email: process.env.GUIDE_SELLER_EMAIL || 'seller-smoke@onos.test', password: process.env.GUIDE_SELLER_PASSWORD || 'Smoke@12345' };
const LINE = process.env.GUIDE_LINE || '2d';
const PRODUCT = process.env.GUIDE_PRODUCT || 'Heavy Cotton™ T-Shirt - 5000';
const OUT = path.resolve(process.env.GUIDE_OUT || path.join(HERE, '../../web/public/guide/order'));
const ASSET_PORT = Number(process.env.GUIDE_ASSET_PORT || 3099);
const ASSET_BASE = `http://127.0.0.1:${ASSET_PORT}`;
const QUALITY = Number(process.env.GUIDE_QUALITY || 0.82);
const MAX_BYTES = 350 * 1024;
const VIEWPORT = { width: 1440, height: 900 };
/** Import: viewport hẹp để ảnh dải ngang đọc được (vẫn ≥ lg nên còn sidebar như laptop thật). */
const IMPORT_VIEWPORT = { width: 1100, height: 900 };
/** Chi tiết đơn: cao hơn để thấy cả khối Địa chỉ giao hàng (cột phải) mà chữ mô tả nhắc tới. */
const DETAIL_VIEWPORT = { width: 1440, height: 1080 };
/** Chọn sản phẩm: đủ cao để lưới thẻ không phải cuộn (không hàng nào bị cắt nửa). */
const PICK_VIEWPORT = { width: 1440, height: 1120 };
const TS_OUT = path.resolve(process.env.GUIDE_TS_OUT || path.join(HERE, '../../web/src/pages/guide/order/guideShots.generated.ts'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'order-guide-'));
const RUN = String(Date.now()).slice(-5);

/** Link hiển thị thay cho URL asset nội bộ trong ảnh (chỉ đổi chữ trên màn, không đổi dữ liệu). */
const DISPLAY_URL = {
  'guide-mockup.svg': 'https://drive.google.com/file/d/demo-mockup/view',
  'guide-design-front.svg': 'https://drive.google.com/file/d/demo-design-front/view',
};

// ─────────────────────────────────────────────────────────── ASSET GIẢ
const GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#c40c68"/></linearGradient></defs>';
const ASSETS = {
  'guide-design-front.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">${GRAD}<rect width="1200" height="1200" fill="url(#g)"/><circle cx="600" cy="520" r="300" fill="#fff" opacity="0.18"/><text x="600" y="540" font-family="Arial" font-size="150" font-weight="700" fill="#fff" text-anchor="middle">SAMPLE</text><text x="600" y="700" font-family="Arial" font-size="90" fill="#fff" text-anchor="middle">DESIGN</text></svg>`,
  'guide-mockup.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">${GRAD}<rect width="1000" height="1000" fill="#eef0f3"/><path d="M300 170 L400 130 Q500 190 600 130 L700 170 L850 290 L770 390 L700 340 L700 870 L300 870 L300 340 L230 390 L150 290 Z" fill="#1f2937"/><rect x="390" y="330" width="220" height="220" fill="url(#g)"/><text x="500" y="455" font-family="Arial" font-size="46" font-weight="700" fill="#fff" text-anchor="middle">SAMPLE</text><text x="500" y="945" font-family="Arial" font-size="34" fill="#6b7280" text-anchor="middle">demo mockup</text></svg>`,
};
const assetServer = http
  .createServer((req, res) => {
    const svg = ASSETS[path.basename((req.url || '').split('?')[0])];
    if (!svg) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(svg);
  })
  .listen(ASSET_PORT, '127.0.0.1');

// ─────────────────────────────────────────────────────────── CSV GIẢ
const CSV_HEADER = 'order_id,identifier,order_name,item,quantity,color,size,shipping,sku,telephone,email,name,country,state,city,address_1,postcode,design_front,mockup,note';
const csvRow = (o) => [o.id, 'demo-store.example', `#${o.id}`, o.item, o.qty, o.color, o.size, 'EXPRESS_US', o.sku, '+1 512 555 0188', o.mail, o.name, 'US', o.state, o.city, o.addr, o.zip, o.design ?? '', `${ASSET_BASE}/guide-mockup.svg`, ''].join(',');
const IMPORT_IDS = [`DEMO-${RUN}-A`, `DEMO-${RUN}-B`];
const baseA = { id: IMPORT_IDS[0], item: 'Heavy Cotton T-Shirt', color: 'BLACK', size: 'S', sku: 'UT-5000-BLK-S', mail: 'emily.johnson@example.com', name: 'Emily Johnson', state: 'CA', city: 'San Diego', addr: '456 Sample Avenue', zip: '92101', design: `${ASSET_BASE}/guide-design-front.svg` };
const baseB = { id: IMPORT_IDS[1], item: "Women's Midweight Tee", color: 'WHITE', size: 'M', sku: 'WT-5000L-WHE-M', mail: 'michael.brown@example.com', name: 'Michael Brown', state: 'NY', city: 'Brooklyn', addr: '789 Example Road', zip: '11201', design: `${ASSET_BASE}/guide-design-front.svg` };
const CSV_ERRORS = path.join(TMP, 'don-hang-demo-loi.csv');
const CSV_VALID = path.join(TMP, 'don-hang-demo.csv');
fs.writeFileSync(CSV_ERRORS, [CSV_HEADER, csvRow({ ...baseA, qty: 'two' }), csvRow({ ...baseB, qty: 1, sku: 'WT-5000L-WHE-MX', design: '' })].join('\n'));
fs.writeFileSync(CSV_VALID, [CSV_HEADER, csvRow({ ...baseA, qty: 2 }), csvRow({ ...baseB, qty: 1 })].join('\n'));

// ─────────────────────────────────────────────────────────── TRÌNH DUYỆT
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.GUIDE_CHANNEL || 'chrome', headless: true });
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'vi-VN', colorScheme: 'light' });
const host = new URL(BASE).hostname;
await context.addCookies([
  { name: 'onos_lang', value: 'vi', domain: host, path: '/' },
  { name: 'onos-theme', value: 'light', domain: host, path: '/' },
]);
await context.addInitScript(() => {
  try { localStorage.setItem('onos-theme', 'light'); } catch { /* bỏ qua */ }
  const css = 'nextjs-portal{display:none!important} div.fixed.top-4.right-4{visibility:hidden!important} *{caret-color:transparent!important}';
  const put = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
  if (document.head) put(); else document.addEventListener('DOMContentLoaded', put);
});
const page = await context.newPage();
const converter = await context.newPage();
const manifest = [];

const FLOW_TITLES = {
  form: 'Tạo đơn trên form',
  push: 'Đẩy sản xuất và theo dõi đơn',
  import: 'Import đơn từ file CSV',
};

/** Điều hướng; thử lại khi bị huỷ giữa chừng (vd `router.replace` sau đăng nhập chen ngang). */
async function go(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 180000 });
      return;
    } catch (err) {
      if (attempt >= 3 || !/ERR_ABORTED|interrupted by another navigation/i.test(String(err))) throw err;
      await page.waitForTimeout(1500);
    }
  }
}

/** Đợi hết spinner tải (spinner tải có `border-t-transparent`; icon xoay của chặng hiện tại thì không). */
async function settle(extra = 600) {
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('.animate-spin.border-t-transparent')).some((el) => el.getClientRects().length > 0), null, { timeout: 90000 });
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

async function text(locator) {
  return (await locator.first().innerText()).replace(/\s+/g, ' ').replace(/\s*\*$/, '').trim();
}

/** Viewport HIỆN TẠI — vài bước đổi cỡ viewport để chụp gọn/đủ hơn (import hẹp, chi tiết đơn cao). */
const vp = () => page.viewportSize() ?? VIEWPORT;

async function setViewport(size) {
  await page.setViewportSize(size);
  await page.waitForTimeout(400);
}

function clampBox(b, pad = 0) {
  const { width: vw, height: vh } = vp();
  const x = Math.max(0, Math.floor(b.x - pad));
  const y = Math.max(0, Math.floor(b.y - pad));
  const r = Math.min(vw, Math.ceil(b.x + b.width + pad));
  const btm = Math.min(vh, Math.ceil(b.y + b.height + pad));
  return { x, y, width: r - x, height: btm - y };
}

const pct = (v) => Math.round(v * 1000) / 10;

async function rawUnion(locators) {
  const boxes = [];
  for (const l of locators) {
    const b = await l.first().boundingBox();
    if (!b) throw new Error(`Không lấy được boundingBox: ${l}`);
    boxes.push(b);
  }
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const btm = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}

async function unionBox(locators, pad) {
  return clampBox(await rawUnion(locators), pad);
}

/**
 * Ảnh không được lộ tài khoản test nội bộ: đổi CHỮ hiển thị (text node + value ô nhập) chứa email/tên
 * tài khoản demo thành dữ liệu mẫu. Không bắn event → state React và dữ liệu gửi đi không đổi.
 */
async function maskAccount() {
  await page.evaluate(({ email, local }) => {
    const hit = (s) => s && (s.includes(email) || s.includes(local));
    const swap = (s) => s.split(email).join('demo@example.com').split(local).join('demo');
    for (const input of document.querySelectorAll('input, textarea')) if (hit(input.value)) input.value = swap(input.value);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (hit(n.nodeValue)) n.nodeValue = swap(n.nodeValue);
  }, { email: SELLER.email, local: SELLER.email.split('@')[0] });
}

/** Đổi CHỮ hiển thị của ô URL asset nội bộ thành link Drive mẫu (không bắn event → state React không đổi). */
async function maskAssetUrls() {
  await page.evaluate(({ base, map }) => {
    for (const input of document.querySelectorAll('input')) {
      if (input.value.startsWith(base)) input.value = map[input.value.split('/').pop()] ?? 'https://drive.google.com/file/d/demo/view';
    }
  }, { base: ASSET_BASE, map: DISPLAY_URL });
}

async function toWebp(png) {
  let q = QUALITY;
  for (;;) {
    const dataUrl = await converter.evaluate(async ({ b64, quality }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', quality);
    }, { b64: png.toString('base64'), quality: q });
    if (!dataUrl.startsWith('data:image/webp')) return { buf: png, ext: 'png' };
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (buf.length <= MAX_BYTES || q <= 0.5) return { buf, ext: 'webp' };
    q -= 0.08;
  }
}

/** Lề (px ảnh) cộng quanh khung phần tử để viền vẽ trên trang hướng dẫn không đè sát chữ bên trong. */
const BOX_PAD = 5;
/** Cỡ ô (px ảnh) của lưới "mực" — ô nào có chữ/ảnh/ô nhập đang hiện thì huy hiệu số tránh đặt lên. */
const INK_CELL = 12;

/**
 * Lưới "mực" của vùng chụp: 1 bit/ô `INK_CELL`, bật khi ô chạm chữ ĐANG HIỆN (text node, kiểm bằng
 * elementFromPoint để bỏ chữ bị cột cuộn/overlay che), ảnh, icon SVG hoặc ô nhập. Trang hướng dẫn dùng để đặt
 * huy hiệu số vào chỗ trống thay vì đè lên chữ bên cạnh. Trả base64 bit-packed (LSB trước), hàng trên xuống.
 */
async function inkGrid(box) {
  const grid = await page.evaluate(({ box, cell }) => {
    const cols = Math.ceil(box.width / cell);
    const rows = Math.ceil(box.height / cell);
    const bits = new Array(cols * rows).fill(0);
    const visible = (el, r) => {
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const at = document.elementFromPoint(x, y);
      return !!at && (at === el || el.contains(at) || at.contains(el));
    };
    const mark = (r) => {
      if (r.width < 1 || r.height < 1) return;
      const x0 = Math.max(0, Math.floor((r.left - box.x) / cell));
      const x1 = Math.min(cols - 1, Math.floor((r.right - box.x - 0.01) / cell));
      const y0 = Math.max(0, Math.floor((r.top - box.y) / cell));
      const y1 = Math.min(rows - 1, Math.floor((r.bottom - box.y - 0.01) / cell));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bits[y * cols + x] = 1;
    };
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.nodeValue.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (visible(el, r)) mark(r);
    }
    for (const el of document.querySelectorAll('img, svg, input, textarea, select')) {
      if (el.tagName.toLowerCase() !== 'svg' && el.closest('svg')) continue;
      const r = el.getBoundingClientRect();
      if (visible(el, r)) mark(r);
    }
    return { cols, rows, bits };
  }, { box, cell: INK_CELL });
  const bytes = Buffer.alloc(Math.ceil(grid.bits.length / 8));
  grid.bits.forEach((b, i) => { if (b) bytes[i >> 3] |= 1 << (i & 7); });
  return { cell: INK_CELL, cols: grid.cols, rows: grid.rows, data: bytes.toString('base64') };
}

/**
 * Chụp 1 bước. `clip`: 'viewport' | mảng locator (lấy hộp bao, cộng `pad`). Mỗi chú thích:
 * `{ target: Locator, label?: string, also?: Locator[] }` — không truyền label thì lấy CHỮ đang hiện
 * của target. `also` = phần tử gộp thêm vào KHUNG viền (vd nhãn của ô nhập) để huy hiệu số không đè lên nhãn.
 */
async function shot({ flow, step, key, shows, clip = 'viewport', pad = 16, callouts, mask = false }) {
  const toastErrors = await page.evaluate(() => Array.from(document.querySelectorAll('div.fixed.top-4.right-4 .text-error')).length);
  if (toastErrors > 0) throw new Error(`[${key}] đang có toast lỗi: ${await page.locator('div.fixed.top-4.right-4').innerText()}`);
  if (mask) await maskAssetUrls();
  await maskAccount();
  const box = clip === 'viewport' ? { x: 0, y: 0, ...vp() } : await unionBox(clip, pad);

  const notes = [];
  for (const [i, c] of callouts.entries()) {
    const loc = c.target.first();
    const b = await loc.boundingBox();
    if (!b) throw new Error(`[${key}] chú thích ${i + 1} không có boundingBox`);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    if (cx < box.x || cx > box.x + box.width || cy < box.y || cy > box.y + box.height) throw new Error(`[${key}] chú thích ${i + 1} (${c.label ?? ''}) nằm ngoài vùng chụp`);
    // Phần tử có thật sự hiện ở tâm không (không bị cột cuộn/overlay che)?
    const hit = await loc.evaluate((el, [x, y]) => { const at = document.elementFromPoint(x, y); return !!at && (el === at || el.contains(at) || at.contains(el)); }, [cx, cy]);
    if (!hit) throw new Error(`[${key}] chú thích ${i + 1} (${c.label ?? ''}) bị che hoặc đã cuộn khuất`);
    // Khung bao theo % vùng chụp (gộp `also`, cộng lề, cắt trong vùng chụp).
    const u = c.also?.length ? await rawUnion([loc, ...c.also]) : b;
    const bx0 = Math.max(box.x, u.x - BOX_PAD);
    const by0 = Math.max(box.y, u.y - BOX_PAD);
    const bx1 = Math.min(box.x + box.width, u.x + u.width + BOX_PAD);
    const by1 = Math.min(box.y + box.height, u.y + u.height + BOX_PAD);
    notes.push({
      n: i + 1,
      xPct: pct((cx - box.x) / box.width),
      yPct: pct((cy - box.y) / box.height),
      boxPct: {
        x: pct((bx0 - box.x) / box.width),
        y: pct((by0 - box.y) / box.height),
        w: pct((bx1 - bx0) / box.width),
        h: pct((by1 - by0) / box.height),
      },
      label: c.label ?? (await text(loc)),
      detail: c.detail,
    });
  }

  const ink = await inkGrid(box);
  const png = await page.screenshot({ clip: box, type: 'png', animations: 'disabled', caret: 'hide' });
  const { buf, ext } = await toWebp(png);
  const file = `${key}.${ext}`;
  fs.writeFileSync(path.join(OUT, file), buf);
  const u = new URL(page.url());
  manifest.push({ flow, step, file, width: box.width, height: box.height, screen: u.pathname + u.search, shows, callouts: notes, ink });
  console.log(`  shot ${file} ${box.width}×${box.height} ${(buf.length / 1024).toFixed(0)} KB`);
}

async function debugShot(name) {
  const p = path.join(TMP, `${name}.png`);
  await page.screenshot({ path: p }).catch(() => {});
  console.log(`  debug ${p}`);
}

// ─────────────────────────────────────────────────────────── LUỒNG 1 — TẠO ĐƠN TRÊN FORM
const lineHref = `/portal/orders/${LINE}`;
let formProductionId = '';
let lineLabel = '';

try {
  console.log('\n## Đăng nhập');
  await go('/login');
  await page.locator('input[type=email]').waitFor({ timeout: 120000 });
  await page.locator('input[type=email]').fill(SELLER.email);
  await page.locator('input[type=password]').fill(SELLER.password);
  await settle();
  const form = page.locator('form');
  await shot({
    flow: 'form', step: 1, key: 'form-01-login',
    shows: 'Màn đăng nhập cổng seller: nhập email và mật khẩu tài khoản khách hàng OnosFactory.',
    clip: [page.locator('h1').locator('xpath=..'), form.locator('xpath=..')], pad: 32,
    callouts: [
      { target: form.locator('input[type=email]'), also: [form.locator('label').nth(0)], label: await text(form.locator('label').nth(0)), detail: 'Email tài khoản khách hàng OnosFactory của bạn.' },
      { target: form.locator('input[type=password]'), also: [form.locator('label').nth(1)], label: await text(form.locator('label').nth(1)), detail: 'Mật khẩu đăng nhập; bấm biểu tượng con mắt để hiện mật khẩu.' },
      { target: form.locator('button[type=submit]'), detail: 'Bấm để vào cổng seller.' },
    ],
  });
  // `shot` đã đổi CHỮ ô email thành demo@example.com cho ảnh — điền lại tài khoản thật trước khi gửi.
  await page.locator('input[type=email]').fill('');
  await page.locator('input[type=email]').fill(SELLER.email);
  // Dev: nodemon API khởi động lại khi có file .ts trong workspace đổi → đăng nhập có thể trượt đúng lúc đó.
  for (let attempt = 1; ; attempt++) {
    await form.locator('button[type=submit]').click();
    const ok = await page.waitForURL(/\/portal/, { timeout: 30000 }).then(() => true, () => false);
    if (ok) break;
    if (attempt >= 4) throw new Error('Đăng nhập seller không thành công sau 4 lần');
    console.log(`  đăng nhập chưa được, thử lại (lần ${attempt + 1})`);
    await page.waitForTimeout(8000);
  }

  // Bước "chọn dòng sản phẩm" chụp SAU (khi danh sách đã có đơn) — xem cuối luồng import.

  console.log('\n## Chọn sản phẩm');
  await go(`${lineHref}/create`);
  const cards = page.locator('button:has(div.aspect-square)');
  await cards.first().waitFor({ timeout: 180000 });
  await settle(1500);
  const productCard = cards.filter({ hasText: PRODUCT }).first();
  const pickTitle = page.locator('h2', { hasText: 'Chọn sản phẩm' });
  const cartTitle = page.locator('h2', { hasText: 'Sản phẩm trong đơn' });
  lineLabel = (await text(page.locator('h1'))).split('·').pop().trim();
  // Cột chọn sản phẩm tự cuộn; ở 900px sản phẩm cần chọn nằm hàng cuối nên cột phải cuộn KỊCH đáy → hàng
  // thẻ trên cùng bị cắt nửa. Chụp bước này ở viewport cao hơn và đưa mọi vùng cuộn về đầu → cả danh sách
  // (kể cả hàng chứa sản phẩm cần chọn) hiện đủ, không có hàng bị cắt.
  await setViewport(PICK_VIEWPORT);
  await productCard.evaluate((el) => {
    for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight) n.scrollTop = 0;
  });
  await settle(800);
  await shot({
    flow: 'form', step: 3, key: 'form-03-pick-product',
    shows: `Màn "Đặt đơn mới" của dòng ${lineLabel}: bên trái là danh mục sản phẩm để chọn (ô tìm theo tên nằm trên đầu danh sách), bên phải là giỏ đơn và địa chỉ giao hàng.`,
    callouts: [
      { target: page.locator('h1').first(), detail: 'Màn đặt đơn của đúng dòng sản phẩm đã chọn; danh sách bên dưới kèm giá theo hạng của bạn.' },
      { target: productCard, label: await text(productCard.locator('p', { hasText: PRODUCT })), detail: 'Bấm vào thẻ sản phẩm để cấu hình biến thể và file in.' },
      { target: cartTitle, detail: 'Giỏ đơn: mỗi sản phẩm thêm vào sẽ thành một dòng sản xuất, dùng chung địa chỉ giao.' },
    ],
  });

  console.log('\n## Cấu hình sản phẩm');
  await setViewport(VIEWPORT);
  await productCard.click();
  await page.getByText('Đổi sản phẩm khác').waitFor({ timeout: 60000 });
  const groups = page.locator('div:has(> p.uppercase):has(> div > button)');
  const groupCount = await groups.count();
  const chosen = [];
  for (let g = 0; g < groupCount; g++) {
    const buttons = groups.nth(g).locator('button');
    const want = g === 0 ? buttons.filter({ hasText: /^BLACK$/i }) : buttons.filter({ hasText: /^L$/ });
    const btn = (await want.count()) > 0 ? want.first() : buttons.nth(Math.min(1, (await buttons.count()) - 1));
    await btn.click();
    chosen.push(btn);
  }
  const qty = page.locator('input[type=number]');
  await qty.fill('2');
  const productBox = page.getByText('Đổi sản phẩm khác').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const qtyLabel = page.locator('label', { hasText: 'Số lượng' });
  await settle();
  const variantCallouts = [
    { target: productBox.locator('p.font-semibold').first(), detail: 'Sản phẩm đang cấu hình; mã SKU và giá đổi theo biến thể bạn chọn.' },
    ...chosen.slice(0, 2).map((b, i) => ({ target: b, detail: i === 0 ? 'Chọn màu — nút đang chọn được tô màu nhấn.' : 'Chọn kích cỡ cho sản phẩm.' })),
    { target: qty, also: [qtyLabel], label: await text(qtyLabel), detail: 'Số lượng in cho sản phẩm này.' },
  ];
  await shot({
    flow: 'form', step: 4, key: 'form-04-variant',
    shows: 'Sau khi chọn sản phẩm: chọn màu, kích cỡ và số lượng; SKU và giá hiện ngay dưới tên sản phẩm.',
    clip: [productBox, qty], pad: 16,
    callouts: variantCallouts,
  });

  console.log('\n## File mockup + design');
  const mockupInput = page.getByPlaceholder('Dán URL ảnh mockup...');
  await mockupInput.fill(`${ASSET_BASE}/guide-mockup.svg`);
  const designInputs = page.getByPlaceholder('https://drive.google.com/...');
  await designInputs.first().fill(`${ASSET_BASE}/guide-design-front.svg`);
  const addBtn = page.getByRole('button', { name: 'Thêm vào đơn hàng' });
  await addBtn.scrollIntoViewIfNeeded();
  await settle(1500);
  const filesCard = addBtn.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const designLabel = page.locator('label', { hasText: 'Link thiết kế' }).first();
  await shot({
    flow: 'form', step: 5, key: 'form-05-files', mask: true,
    shows: 'Khối file sản xuất: dán link (hoặc tải lên) ảnh mockup và file thiết kế theo từng vị trí in, rồi thêm sản phẩm vào đơn.',
    clip: [filesCard], pad: 16,
    callouts: [
      { target: mockupInput, also: [page.locator('label', { hasText: 'Ảnh mockup' })], label: await text(page.locator('label', { hasText: 'Ảnh mockup' })), detail: 'Ảnh mockup do bạn cung cấp để xưởng đối chiếu — không phải ảnh mẫu của sản phẩm.' },
      { target: designInputs.first(), also: [designLabel], label: await text(designLabel), detail: 'File thiết kế cho vị trí in; vị trí có dấu * là bắt buộc.' },
      { target: addBtn, detail: 'Nút sáng lên khi đã đủ mockup và design — bấm để đưa sản phẩm vào giỏ.' },
    ],
  });

  console.log('\n## Giỏ + địa chỉ');
  await addBtn.click();
  await page.locator('h2', { hasText: 'Sản phẩm trong đơn (1)' }).waitFor({ timeout: 30000 });
  const shipCard = page.locator('h2', { hasText: 'Địa chỉ giao hàng' }).locator('xpath=..');
  const addr = { firstName: 'John', lastName: 'Smith', address1: '123 Demo Street', address2: '', company: '', city: 'Austin', postcode: '78701', state: 'TX', country: 'US', phone: '+1 512 555 0142', email: 'john@example.com' };
  const addrInputs = shipCard.locator('input');
  const fields = Object.keys(addr);
  for (let i = 0; i < fields.length; i++) if (addr[fields[i]]) await addrInputs.nth(i).fill(addr[fields[i]]);
  const note = page.locator('textarea');
  await note.fill('Demo order — please pack carefully.');
  const submitBtn = page.getByRole('button', { name: /^Đặt đơn \(/ });
  // Cột phải tự cuộn: cuộn tới đáy khối địa chỉ để thấy đủ ô bắt buộc (kể cả Số điện thoại).
  await shipCard.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  const fieldWrap = (label) => shipCard.locator('div', { has: page.locator('label', { hasText: label }) }).last();
  const fieldInput = (label) => fieldWrap(label).locator('input');
  const fieldLabel = (label) => fieldWrap(label).locator('label');
  await settle(1200);
  await shot({
    flow: 'form', step: 6, key: 'form-06-cart-address',
    shows: 'Cột bên phải: giỏ đơn (cuộn lên để xem), địa chỉ giao hàng của người nhận (dữ liệu mẫu), ghi chú và nút đặt đơn.',
    clip: [shipCard, submitBtn], pad: 12,
    callouts: [
      { target: fieldInput('Địa chỉ *').first(), also: [fieldLabel('Địa chỉ *').first()], label: 'Địa chỉ', detail: 'Một địa chỉ giao hàng dùng chung cho mọi sản phẩm trong đơn; ô có * là bắt buộc.' },
      { target: fieldInput('Số điện thoại'), also: [fieldLabel('Số điện thoại')], label: 'Số điện thoại', detail: 'Số điện thoại người nhận (bắt buộc, 9–15 chữ số).' },
      { target: note, also: [page.locator('label', { hasText: 'Ghi chú' })], label: await text(page.locator('label', { hasText: 'Ghi chú' })), detail: 'Ghi chú thêm cho xưởng (không bắt buộc).' },
      { target: submitBtn, detail: 'Gửi đơn — đơn được tạo ở trạng thái Chờ đẩy SX.' },
    ],
  });

  console.log('\n## Gửi đơn');
  const [createRes] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/customer\/orders$/.test(r.url()), { timeout: 60000 }),
    submitBtn.click(),
  ]);
  const created = await createRes.json();
  if (!createRes.ok()) throw new Error(`Tạo đơn lỗi ${createRes.status()}: ${JSON.stringify(created).slice(0, 300)}`);
  formProductionId = created.data?.items?.[0]?.productionId ?? '';
  console.log(`  đơn form: ${formProductionId}`);
  await page.waitForURL(/status=pending/, { timeout: 60000 });
  const formRow = page.locator('tbody tr', { hasText: formProductionId });
  await formRow.waitFor({ timeout: 60000 });
  await settle(1500);
  await shot({
    flow: 'form', step: 7, key: 'form-07-pending',
    shows: 'Sau khi gửi, trang chuyển về danh sách đơn của dòng sản phẩm, lọc sẵn tab Chờ đẩy SX — đơn mới nằm ở đây.',
    callouts: [
      { target: page.locator('button', { hasText: 'Chờ đẩy SX' }).first(), detail: 'Tab các đơn đã tạo nhưng chưa đưa vào sản xuất.' },
      { target: formRow.locator('a.font-mono').first(), detail: 'Mã sản xuất của đơn — đi xuyên suốt tới xưởng và trang tra cứu.' },
      { target: formRow.locator('td').nth(5).locator('span').first(), detail: 'Trạng thái hiện tại của đơn.' },
    ],
  });

  // ─────────────────────────────────────────────────────────── LUỒNG 3 — IMPORT CSV
  console.log('\n## Import — mở trang');
  // Trang import là dải ngang (thanh công cụ, bảng xem trước). Chụp ở 1440 cho ra ảnh 1222×140…291 — hiện trên
  // trang hướng dẫn thì chữ quá nhỏ. Viewport hẹp hơn → cùng nội dung trong khung hẹp hơn → chữ to hơn khi hiển thị.
  await setViewport(IMPORT_VIEWPORT);
  await go(`${lineHref}/import`);
  const chooseBtn = page.getByRole('button', { name: 'Chọn file' });
  await chooseBtn.waitFor({ timeout: 180000 });
  await settle();
  const templateBtn = page.getByRole('button', { name: 'Tải file mẫu' });
  const lookupBtn = page.locator(`a[href^="/portal/catalog"] button`);
  const dropzone = chooseBtn.locator('xpath=ancestor::div[contains(@class,"border-dashed")][1]');
  await shot({
    flow: 'import', step: 1, key: 'import-01-open',
    shows: 'Trang Import đơn từ file: tải file mẫu, tra SKU sản phẩm, rồi chọn file .csv/.xlsx để xem trước.',
    clip: [page.locator(`a[href="${lineHref}"]`).filter({ hasText: 'Quản lý đơn' }), templateBtn, dropzone], pad: 16,
    callouts: [
      { target: templateBtn, detail: 'Tải file mẫu đúng định dạng (template OnosPod quen thuộc).' },
      { target: lookupBtn, detail: 'Mở danh mục sản phẩm để tra mã SKU điền vào cột sku.' },
      { target: chooseBtn, detail: 'Chọn file đã điền để hệ thống kiểm tra từng dòng.' },
    ],
  });

  console.log('\n## Import — tra SKU');
  await setViewport(VIEWPORT);
  await lookupBtn.click();
  await page.waitForURL(/\/portal\/catalog/, { timeout: 120000 });
  const catCard = page.locator('a[href^="/portal/catalog/"]', { hasText: PRODUCT }).first();
  await catCard.waitFor({ timeout: 120000 });
  await catCard.click();
  const skuTh = page.locator('th', { hasText: /^SKU$/ });
  await skuTh.waitFor({ timeout: 120000 });
  const skuHint = page.getByText('Chép SKU để điền cột sku trong file import');
  await skuHint.scrollIntoViewIfNeeded();
  await settle(1200);
  const skuTable = skuTh.locator('xpath=ancestor::table[1]');
  const firstSku = skuTable.locator('tbody tr').first().locator('td').first();
  await shot({
    flow: 'import', step: 2, key: 'import-02-lookup-sku',
    shows: 'Chi tiết sản phẩm trong Danh mục: bảng Biến thể & giá liệt kê mã SKU của từng màu/cỡ để chép vào file import.',
    clip: [skuHint, skuTable], pad: 20,
    callouts: [
      { target: skuHint, detail: 'Gợi ý: chép mã SKU của biến thể cần đặt.' },
      { target: skuTh, detail: 'Cột mã SKU — điền đúng mã này vào cột sku của file.' },
      { target: firstSku, detail: 'Mỗi dòng là một biến thể (màu + cỡ) với SKU riêng.' },
    ],
  });

  console.log('\n## Import — file có lỗi');
  await setViewport(IMPORT_VIEWPORT);
  await go(`${lineHref}/import`);
  await chooseBtn.waitFor({ timeout: 120000 });
  await page.locator('input[type=file]').setInputFiles(CSV_ERRORS);
  await page.getByText(/dòng → \d+ đơn/).waitFor({ timeout: 60000 });
  await page.getByText('Đang đối chiếu SKU với catalog…').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  await settle(1500);
  const summary = page.getByText(/dòng → \d+ đơn/).locator('xpath=..');
  const previewTable = page.locator('table').first();
  const errorBadge = page.locator('span', { hasText: /ô lỗi$/ }).first();
  const qtyErr = previewTable.locator('td.bg-error-bg p.text-error:not(.font-medium)').first();
  const skuErr = previewTable.locator('td.bg-error-bg p.text-error.font-medium').filter({ hasNotText: 'two' }).first();
  const importBtn = page.getByRole('button', { name: /^Import \d+ đơn$/ });
  await shot({
    flow: 'import', step: 3, key: 'import-03-preview-errors',
    shows: 'Bảng xem trước khi file còn lỗi: ô sai bị bôi đỏ kèm lý do, cột Sản phẩm hệ thống báo SKU không tồn tại, nút Import bị khóa.',
    clip: [summary, previewTable], pad: 16,
    callouts: [
      { target: errorBadge, detail: 'Tổng số ô lỗi cần sửa trong file.' },
      { target: qtyErr, detail: 'Ô số lượng sai định dạng — phải là số nguyên dương.' },
      { target: skuErr, detail: 'SKU không khớp sản phẩm nào trong danh mục — kiểm lại mã.' },
      { target: importBtn, detail: 'Chỉ bấm được khi file hết lỗi; sửa file rồi chọn lại.' },
    ],
  });

  console.log('\n## Import — file hợp lệ');
  await page.getByRole('button', { name: 'Chọn lại' }).click();
  await page.locator('input[type=file]').setInputFiles(CSV_VALID);
  await page.getByText('Tất cả dòng hợp lệ').waitFor({ timeout: 60000 });
  await page.getByText('Đang đối chiếu SKU với catalog…').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  await settle(2000);
  const sysCell = previewTable.locator('tbody tr').first().locator('td').nth(4);
  await shot({
    flow: 'import', step: 4, key: 'import-04-preview-valid',
    shows: 'File đã sửa: mọi dòng hợp lệ, cột Sản phẩm hệ thống hiện đúng sản phẩm, biến thể và giá cho từng SKU.',
    clip: [summary, previewTable], pad: 16,
    callouts: [
      { target: page.getByText('Tất cả dòng hợp lệ'), detail: 'Không còn ô lỗi — sẵn sàng import.' },
      { target: sysCell.locator('p.font-medium'), detail: 'Sản phẩm hệ thống nhận ra từ SKU: kiểm tên, màu/cỡ và giá trước khi import.' },
      { target: importBtn, detail: 'Tạo toàn bộ đơn trong file ở trạng thái Chờ đẩy SX.' },
    ],
  });

  console.log('\n## Import — kết quả');
  await importBtn.click();
  const goPending = page.getByRole('button', { name: 'Xem đơn vừa tạo' });
  await goPending.waitFor({ timeout: 60000 });
  await settle(1000);
  const createdBadge = page.locator('span', { hasText: /tạo mới$/ }).first();
  const resultList = page.locator('div.divide-y').last();
  if (!/^[1-9]/.test(await text(createdBadge))) throw new Error(`Import không tạo được đơn: ${await text(resultList)}`);
  await shot({
    flow: 'import', step: 5, key: 'import-05-result',
    shows: 'Kết quả import: số đơn tạo mới / trùng / lỗi và trạng thái từng đơn theo order_id.',
    clip: [createdBadge.locator('xpath=..'), resultList], pad: 16,
    callouts: [
      { target: createdBadge, detail: 'Số đơn đã tạo thành công.' },
      { target: resultList.getByText('Đã tạo').first(), detail: 'Trạng thái từng đơn theo order_id trong file.' },
      { target: goPending, detail: 'Mở tab Chờ đẩy SX để đẩy các đơn vừa tạo vào sản xuất.' },
    ],
  });
  await goPending.click();
  await page.waitForURL(/status=pending/, { timeout: 60000 });
  await setViewport(VIEWPORT);

  // ─────────────────────────────────────────────────────────── LUỒNG 1 — bước chọn dòng (lúc này đã có đơn)
  console.log('\n## Chọn dòng sản phẩm');
  await go(lineHref);
  await page.locator('tbody tr').first().waitFor({ timeout: 120000 });
  await settle(1500);
  const navOrders = page.locator('nav button', { hasText: 'Quản lý đơn' });
  const navLine = page.locator(`nav a[href="${lineHref}"]`);
  const heroCreate = page.locator(`a[href="${lineHref}/create"]`).first();
  const heroImport = page.locator(`a[href="${lineHref}/import"]`).first();
  await shot({
    flow: 'form', step: 2, key: 'form-02-choose-line',
    shows: `Sau đăng nhập: mở menu Quản lý đơn ở thanh bên, chọn dòng sản phẩm (ở đây là ${lineLabel}) để vào trang đơn của dòng đó.`,
    callouts: [
      { target: navOrders, detail: 'Menu đơn hàng — xổ ra 6 dòng sản phẩm: 3D, 2D, Gỗ, Thêu, LED, Canvas.' },
      { target: navLine, detail: 'Chọn đúng dòng sản phẩm muốn đặt.' },
      { target: heroCreate, detail: 'Tạo đơn trên form cho dòng sản phẩm này.' },
      { target: heroImport, detail: 'Hoặc import nhiều đơn cùng lúc từ file CSV/Excel.' },
    ],
  });

  // ─────────────────────────────────────────────────────────── LUỒNG 2 — ĐẨY SẢN XUẤT + THEO DÕI
  console.log('\n## Push — chọn đơn');
  await go(`${lineHref}?status=pending`);
  await page.locator('tbody tr').first().waitFor({ timeout: 120000 });
  await settle(1200);
  const mine = [formProductionId, ...IMPORT_IDS];
  for (const code of mine) await page.locator('tbody tr', { hasText: code }).first().waitFor({ timeout: 30000 });
  // Tài khoản demo chỉ chứa đơn demo → chọn TẤT CẢ đơn chờ (ô tiêu đề), để đơn sót từ lần chạy hỏng trước cũng đi luôn.
  await page.locator('thead input[type=checkbox]').check();
  const pushSelected = page.getByRole('button', { name: /^Push \d+ đơn$/ });
  await pushSelected.waitFor({ timeout: 10000 });
  const firstMine = page.locator('tbody tr', { hasText: formProductionId }).first();
  await settle(600);
  await shot({
    flow: 'push', step: 1, key: 'push-01-select',
    shows: 'Tab Chờ đẩy SX: tick chọn các đơn cần sản xuất, rồi bấm nút Push ở góc phải (hoặc Push từng đơn ở cuối dòng).',
    callouts: [
      { target: page.locator('button', { hasText: 'Chờ đẩy SX' }).first(), detail: 'Chỉ đơn ở tab này mới đẩy sản xuất được.' },
      { target: firstMine.locator('input[type=checkbox]'), label: 'Ô chọn đơn', detail: 'Tick từng đơn, hoặc ô ở tiêu đề bảng để chọn tất cả đơn chờ.' },
      { target: pushSelected, detail: 'Đẩy toàn bộ đơn đã tick vào sản xuất.' },
      { target: firstMine.getByRole('button', { name: 'Push', exact: true }), detail: 'Đẩy riêng một đơn.' },
    ],
  });

  console.log('\n## Push — dialog giá');
  const dialog = page.locator('div.max-w-2xl').filter({ hasText: 'Push to production' });
  const confirmBtn = dialog.getByRole('button', { name: /^Xác nhận push/ });
  // Dev: nodemon của API tự khởi động lại khi Next ghi file .ts → push-preview có thể trượt đúng lúc đó
  // (dialog rỗng, tổng $0.00). Đóng và mở lại dialog tối đa 3 lần.
  for (let attempt = 1; ; attempt++) {
    await pushSelected.click();
    await confirmBtn.waitFor({ timeout: 30000 });
    const ready = await page
      .waitForFunction(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /Xác nhận push \([1-9]/.test(x.textContent || '')); return b && !b.disabled; }, null, { timeout: 45000 })
      .then(() => true, () => false);
    if (ready) break;
    if (attempt >= 3) throw new Error('Dialog push không tải được giá (push-preview lỗi?)');
    console.log(`  push-preview chưa có dữ liệu, mở lại dialog (lần ${attempt + 1})`);
    await dialog.locator('button').first().click();
    await page.waitForTimeout(8000);
  }
  await settle(800);
  await shot({
    flow: 'push', step: 2, key: 'push-02-dialog',
    shows: 'Hộp xác nhận Push to production: giá chốt từng sản phẩm theo hạng của bạn và tổng tiền trước khi đẩy.',
    clip: [dialog], pad: 32,
    callouts: [
      { target: dialog.locator('h2'), detail: 'Số đơn sẽ được đẩy vào sản xuất.' },
      { target: dialog.locator('tbody tr td:last-child').first(), detail: 'Đơn giá × số lượng của từng sản phẩm, đã áp ưu đãi nếu có.' },
      { target: dialog.locator('p.text-sm.font-bold'), detail: 'Tổng tiền chốt tại thời điểm push.' },
      { target: confirmBtn, detail: 'Xác nhận để đưa đơn vào sản xuất.' },
    ],
  });

  console.log('\n## Push — xác nhận');
  const [pushRes] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/customer\/orders\/push$/.test(r.url()), { timeout: 120000 }),
    confirmBtn.click(),
  ]);
  const pushed = await pushRes.json();
  const pushedOk = (pushed.data?.results ?? []).filter((r) => r.status === 'pushed').length;
  console.log(`  pushed ${pushedOk}/${mine.length}`);
  if (pushedOk === 0) throw new Error(`Push không thành công: ${JSON.stringify(pushed).slice(0, 400)}`);

  await go(lineHref);
  const pushedRow = page.locator('tbody tr', { hasText: formProductionId }).first();
  await pushedRow.waitFor({ timeout: 120000 });
  await settle(1500);
  const statusCell = pushedRow.locator('td').nth(5);
  const statusBadge = statusCell.locator('span').first();
  const statusLabel = await text(statusBadge);
  const stageText = statusCell.locator('span.text-text-muted').last();
  const statusCallouts = [
    { target: page.locator('button', { hasText: statusLabel }).first(), detail: 'Đơn đã rời tab Chờ đẩy SX và sang tab trạng thái mới.' },
    { target: statusBadge, detail: 'Trạng thái đơn sau khi push.' },
  ];
  if ((await stageText.count()) > 0) statusCallouts.push({ target: stageText, detail: 'Chặng sản xuất hiện tại của đơn.' });
  statusCallouts.push({ target: pushedRow.locator('a.font-mono').first(), detail: 'Bấm mã đơn để xem chi tiết và tiến trình.' });
  await shot({
    flow: 'push', step: 3, key: 'push-03-status',
    shows: 'Danh sách đơn sau khi push: đơn chuyển trạng thái và hiện chặng sản xuất đang ở.',
    callouts: statusCallouts,
  });

  console.log('\n## Chi tiết đơn');
  await pushedRow.locator('a.font-mono').first().click();
  await page.waitForURL(new RegExp(`/portal/orders/${formProductionId}`), { timeout: 120000 });
  await page.getByText('Tiến trình sản xuất').waitFor({ timeout: 120000 });
  await setViewport(DETAIL_VIEWPORT);
  const editAddressBtn = page.getByRole('button', { name: 'Sửa địa chỉ' });
  await editAddressBtn.waitFor({ timeout: 60000 });
  await editAddressBtn.scrollIntoViewIfNeeded();
  await settle(1500);
  const header = page.locator('h1').first();
  const mockupSave = page.getByRole('button', { name: 'Lưu thay đổi' }).first();
  await shot({
    flow: 'push', step: 4, key: 'push-04-detail', mask: true,
    shows: 'Trang chi tiết đơn: mã sản xuất, trạng thái, dòng thời gian các chặng sản xuất, thiết kế, link tra cứu công khai, mockup và địa chỉ giao hàng (sửa được sau khi push).',
    callouts: [
      { target: header, detail: 'Mã sản xuất của đơn.' },
      { target: page.getByText('Tiến trình sản xuất'), detail: 'Các chặng sản xuất, chặng đang làm và mốc thời gian.' },
      { target: page.locator('a[href*="/track/"]').first(), detail: 'Link tra cứu công khai — gửi cho người mua để họ tự theo dõi.' },
      { target: mockupSave, detail: 'Dán link mockup mới rồi lưu — sửa được cả sau khi đã push.' },
      { target: editAddressBtn, detail: 'Mở form sửa địa chỉ giao hàng của đơn.' },
    ],
  });
  await setViewport(VIEWPORT);

  console.log('\n## Tra cứu công khai');
  await go(`/track/${encodeURIComponent(formProductionId)}`);
  await page.locator('p.font-mono', { hasText: formProductionId }).waitFor({ timeout: 120000 });
  await settle(1500);
  const trackIdCard = page.locator('p.font-mono', { hasText: formProductionId });
  const progressTitle = page.locator('main h3, main [class*="font-"]').filter({ hasText: /^Tiến trình/ }).first();
  const trackCallouts = [
    { target: page.locator('form button[type=submit]'), detail: 'Người mua dán mã sản xuất vào ô tìm kiếm rồi bấm Tra cứu — không cần đăng nhập.' },
    { target: trackIdCard, detail: 'Mã sản xuất của đơn đang xem.' },
  ];
  if ((await progressTitle.count()) > 0) trackCallouts.push({ target: progressTitle, detail: 'Tiến trình sản xuất cập nhật theo từng chặng.' });
  await shot({
    flow: 'push', step: 5, key: 'push-05-track',
    shows: 'Trang tra cứu công khai /track/<mã sản xuất>: người mua xem trạng thái và tiến trình đơn mà không cần tài khoản.',
    callouts: trackCallouts,
  });
} catch (err) {
  await debugShot('failed');
  console.error(`\nLỖI: ${err?.stack || err}`);
  process.exitCode = 1;
}

// ─────────────────────────────────────────────────────────── MANIFEST
const order = ['form', 'push', 'import'];
const flows = order
  .map((flow) => ({ flow, title: FLOW_TITLES[flow], steps: manifest.filter((m) => m.flow === flow).sort((a, b) => a.step - b.step) }))
  .filter((f) => f.steps.length > 0);
/**
 * Sinh `guideShots.generated.ts` cho trang hướng dẫn (apps/web): chỉ hình học — file/kích thước/toạ độ/khung.
 * Trang import thẳng file này nên KHÔNG còn bước chép tay số từ manifest. Viết đúng khuôn prettier của apps/web
 * (nháy đơn, dấu phẩy cuối, printWidth 120) để ESLint sạch mà không phải chạy format.
 */
function writeShotsTs(entries) {
  const lines = [
    '/**',
    ' * TỰ SINH bởi `apps/seller/scripts/capture-order-guide.mjs` — KHÔNG sửa tay, chạy lại script để cập nhật.',
    ' * Toạ độ theo % ảnh, lấy từ boundingBox thật của phần tử (xem OrderGuide.md §3, §6).',
    ' */',
    '',
    "import type { GuideShot } from './guideTypes';",
    '',
    'export const GUIDE_SHOTS = {',
  ];
  for (const m of entries) {
    lines.push(`  '${m.file.replace(/\.\w+$/, '')}': {`, `    file: '${m.file}',`, `    width: ${m.width},`, `    height: ${m.height},`, '    callouts: [');
    for (const c of m.callouts) {
      const b = c.boxPct;
      lines.push(`      { n: ${c.n}, xPct: ${c.xPct}, yPct: ${c.yPct}, boxPct: { x: ${b.x}, y: ${b.y}, w: ${b.w}, h: ${b.h} } },`);
    }
    lines.push('    ],', '    ink: {', `      cell: ${m.ink.cell},`, `      cols: ${m.ink.cols},`, `      rows: ${m.ink.rows},`, `      data: '${m.ink.data}',`, '    },', '  },');
  }
  lines.push('} satisfies Record<string, GuideShot>;', '');
  fs.writeFileSync(TS_OUT, lines.join('\n'));
  console.log(`ts: ${TS_OUT}`);
}

if (process.exitCode !== 1) {
  // Lưới mực chỉ phục vụ đặt huy hiệu → nằm trong file TS sinh ra, không làm rối manifest (manifest để người đọc soát).
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(flows, (k, v) => (k === 'ink' ? undefined : v), 2) + '\n');
  writeShotsTs(flows.flatMap((f) => f.steps));
  console.log(`\nmanifest: ${path.join(OUT, 'manifest.json')} · ${manifest.length} ảnh · đơn demo: ${formProductionId} + ${IMPORT_IDS.join(', ')}`);
}

await browser.close();
assetServer.close();
