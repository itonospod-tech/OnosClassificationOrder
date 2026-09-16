/**
 * Chụp ảnh THẬT giao diện apps/web cho trang hướng dẫn quy trình DTF theo vai (TASK-02).
 * Kịch bản từng ảnh: documents/Plans/DtfRoleGuide-Storyboard.md §5. Dữ liệu: seed-demo.mjs.
 *
 * Khuôn giống apps/seller/scripts/capture-order-guide.mjs (TASK-01): chụp đè theo tên cố định, toạ độ chú thích
 * lấy từ boundingBox thật (`boxPct` % vùng chụp, cộng lề 5px) + lưới "mực" để trang đặt huy hiệu.
 *
 * KHÔNG ghi `.ts` vào workspace (nodemon API theo dõi apps/**\/*.ts): hình học + lưới mực ghi ra
 * `scripts/dtf-guide/out/guideShots.generated.json`; DEV dựng trang chuyển sang `guideShots.generated.ts`.
 *
 * CHE DỮ LIỆU THẬT: DB local là bản sao production và nhiều widget KHÔNG lọc theo xưởng. Script chặn response API
 * ở trình duyệt (chỉ giữ dữ liệu DEMO, đếm lại tổng) và ẩn các khối số toàn nhà máy — xem `installMasks()` và
 * trường `masked` của từng ảnh trong manifest. Sau khi chụp PHẢI mở từng ảnh soát lại bằng mắt.
 *
 * Chạy (cần API :3007 + Web :5173 đang chạy, đã chạy seed-demo.mjs TRONG NGÀY — bảng In chỉ hiện đơn vào SX hôm nay):
 *   PLAYWRIGHT_PATH=/path/to/playwright-core/index.mjs \
 *     node apps/web/scripts/dtf-guide/capture.mjs --roles support,designer-leader,designer
 *   … --roles print,press,qc-post-press,pack,admin     (tên ngắn → thư mục fulfillment-<công đoạn>/, admin/)
 * CHẠY MỘT LỆNH, KHÔNG song song: các lượt ghi đè manifest của nhau. Manifest gộp theo từng ảnh.
 * Chụp lại VÀI ảnh, giữ nguyên ảnh khác của vai: `--shots designer/02-task-card,designer-leader/01-assign-backlog`.
 * Ảnh `fulfillment-pack/05-scan-done` TIÊU HAO đơn DEMO-DTF-29 (quét N- rồi OK thật) — lượt sau tự bỏ qua, giữ ảnh cũ.
 *
 * Env: DTF_WEB_BASE (http://localhost:5173), DTF_API_BASE (http://127.0.0.1:3007/api/v1), DTF_DEMO_PASSWORD,
 *      DTF_ASSET_PORT (3098), DTF_OUT (apps/web/public/guide/dtf), DTF_SHOTS_OUT (scripts/dtf-guide/out/…json),
 *      DTF_CHANNEL (chrome), DTF_QUALITY (0.82), PLAYWRIGHT_PATH.
 */

// Lint: file chạy trong Node (globals node do config base cấp cho *.mjs), nhưng các hàm truyền vào
// page.evaluate / addInitScript chạy TRONG trình duyệt → khai báo biến trình duyệt dùng ở đó.
// console.log là đầu ra tiến độ của script CLI này.
/* global document, Image, NodeFilter, innerWidth, innerHeight, localStorage, getComputedStyle */
/* eslint-disable no-console */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Nạp scripts/dtf-guide/.env.local (gitignore) — biến đã đặt sẵn thắng file. KHÔNG in giá trị.
{
  const file = path.join(HERE, '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const pw = process.env.PLAYWRIGHT_PATH;
const { chromium } = await import(pw ? pathToFileURL(pw).href : 'playwright-core');
const WEB = (process.env.DTF_WEB_BASE || 'http://localhost:5173').replace(/\/$/, '');
const API = (process.env.DTF_API_BASE || 'http://127.0.0.1:3007/api/v1').replace(/\/$/, '');
const DEMO_PASSWORD = process.env.DTF_DEMO_PASSWORD || '';
if (!DEMO_PASSWORD) {
  console.error('BLOCKED: thiếu DTF_DEMO_PASSWORD (đặt trong scripts/dtf-guide/.env.local).');
  process.exit(3);
}
const ASSET_PORT = Number(process.env.DTF_ASSET_PORT || 3098);
const OUT = path.resolve(process.env.DTF_OUT || path.join(HERE, '../../public/guide/dtf'));
const SHOTS_OUT = path.resolve(process.env.DTF_SHOTS_OUT || path.join(HERE, 'out/guideShots.generated.json'));
const QUALITY = Number(process.env.DTF_QUALITY || 0.82);
const MAX_BYTES = 350 * 1024;
const VIEWPORT = { width: 1440, height: 900 };
const BOX_PAD = 5;
const INK_CELL = 12;

const DEMO_PREFIX = 'DEMO-DTF-';
const DEMO_FACTORY = 'DEMO-DTF';
const DEMO_PRODUCT = 'DEMO DTF Camo Shirt';
const DEMO_SKU = 'DEMO-SHOP';
const isDemoEmail = (e) => typeof e === 'string' && /^demo\.[a-z.]+@example\.com$/i.test(e);
const isDemoCode = (c) => typeof c === 'string' && c.startsWith(DEMO_PREFIX);

const ROLE_ACCOUNTS = {
  support: 'demo.support@example.com',
  'designer-leader': 'demo.leader@example.com',
  designer: 'demo.designer.a@example.com',
  'fulfillment-print': 'demo.in@example.com',
  'fulfillment-press': 'demo.ep@example.com',
  'fulfillment-qc-post-press': 'demo.qc@example.com',
  'fulfillment-pack': 'demo.donghang@example.com',
  admin: 'demo.admin@example.com',
};
/** `--roles print,press,qc-post-press,pack,admin` — tên ngắn theo công đoạn → khoá vai (thư mục ảnh). */
const ROLE_ALIASES = { print: 'fulfillment-print', press: 'fulfillment-press', 'qc-post-press': 'fulfillment-qc-post-press', qc: 'fulfillment-qc-post-press', pack: 'fulfillment-pack' };
const ROLE_TITLES = {
  support: 'Support — Soát tool',
  'designer-leader': 'Designer Leader',
  designer: 'Designer',
  'fulfillment-print': 'Công nhân In',
  'fulfillment-press': 'Công nhân Ép',
  'fulfillment-qc-post-press': 'Công nhân QC sau ép',
  'fulfillment-pack': 'Công nhân Đóng hàng',
  admin: 'Quản lý xưởng (Admin)',
};

const argv = process.argv.slice(2);
const argOf = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] || '' : null);
/**
 * `--shots designer/02-task-card,designer-leader/01-assign-backlog` — CHỈ ghi các ảnh này (vai vẫn chạy đủ kịch bản để
 * tới đúng màn, ảnh khác bỏ qua KHÔNG ghi file). Manifest + hình học gộp theo từng ảnh → 50 ảnh còn lại giữ nguyên byte.
 * Không kèm `--roles` → vai lấy từ danh sách ảnh. KHÔNG dùng cho vai có bước tiêu hao dữ liệu (vd `fulfillment-pack`).
 */
const ONLY_SHOTS = new Set((argOf('--shots') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const ROLES = (argOf('--roles') ?? (ONLY_SHOTS.size ? [...new Set([...ONLY_SHOTS].map((s) => s.split('/')[0]))].join(',') : 'support,designer-leader,designer'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((r) => ROLE_ALIASES[r] ?? r);
for (const s of ONLY_SHOTS) {
  if (!ROLES.includes(s.split('/')[0])) {
    console.error(`--shots: ảnh "${s}" không thuộc vai đang chạy (${ROLES.join(', ')})`);
    process.exit(2);
  }
}
for (const r of ROLES) {
  const why = !ROLE_TITLES[r]
    ? `--roles: vai không hợp lệ "${r}" (hợp lệ: ${Object.keys(ROLE_TITLES).join(', ')})`
    : !ROLE_ACCOUNTS[r]
      ? `Vai "${r}" chưa có kịch bản chụp trong script này (lượt sau) — xem Storyboard §5.`
      : '';
  if (why) {
    console.error(why);
    process.exit(2);
  }
}
for (const u of [WEB, API]) {
  const h = new URL(u).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(h)) {
    console.error(`TỪ CHỐI: ${u} không phải localhost.`);
    process.exit(2);
  }
}

// ─────────────────────────────────────────────────────────── API (node) — lấy id tài khoản demo + đơn demo
async function api(token, method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) throw new Error(`${method} ${p} → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}
// POST /auth/login trả phẳng `{ userId, accessToken, user }` (không bọc `data`).
const apiLogin = async (email) => {
  const r = await api(null, 'POST', '/auth/login', { email, password: DEMO_PASSWORD, recaptchaToken: '' });
  return r.accessToken ?? r.data?.accessToken;
};

let supportToken;
try {
  supportToken = await apiLogin(ROLE_ACCOUNTS.support);
} catch (err) {
  console.error(`BLOCKED: tài khoản demo chưa đăng nhập được (${err.message}). Chạy seed-demo.mjs trước.`);
  process.exit(3);
}
const demoUserIds = new Set();
for (const email of ['demo.leader@example.com', 'demo.designer.a@example.com', 'demo.designer.b@example.com']) {
  try {
    const t = await apiLogin(email);
    demoUserIds.add(String((await api(t, 'GET', '/auth/me')).data._id));
  } catch (err) {
    console.error(`BLOCKED: ${email} — ${err.message}`);
    process.exit(3);
  }
}
const demoCodes = Array.from({ length: 30 }, (_, i) =>`${DEMO_PREFIX}${String(i + 1).padStart(2, '0')}`);
const demoOrders = [];
for (const code of demoCodes) {
  try {
    demoOrders.push((await api(supportToken, 'GET', `/orders/by-production-id/${code}`)).data);
  } catch {
    /* đơn chưa seed — bỏ qua */
  }
}
if (demoOrders.length === 0) {
  console.error('BLOCKED: không có đơn DEMO-DTF-* — chạy seed-demo.mjs trước.');
  process.exit(3);
}
const demoFactoryId = demoOrders[0].factoryId;
const vnDay = (d) => new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────── ASSET GIẢ (mockup + design)
const svg = (label, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${bg}"/><path d="M240 140 L320 105 Q400 150 480 105 L560 140 L680 235 L615 315 L560 275 L560 700 L240 700 L240 275 L185 315 L120 235 Z" fill="#374151"/><rect x="310" y="265" width="180" height="180" fill="#f59e0b"/><text x="400" y="370" font-family="Arial" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">${label}</text><text x="400" y="760" font-family="Arial" font-size="30" fill="#6b7280" text-anchor="middle">DEMO</text></svg>`;
const assetServer = http
  .createServer((req, res) => {
    const name = path.basename((req.url || '').split('?')[0]);
    if (!/^dtf-[\w-]+\.svg$/.test(name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const bg = ['#e5e7eb', '#d9f99d', '#fde68a', '#bfdbfe'][name.length % 4];
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(svg(name.includes('design') ? 'DESIGN' : 'DTF', bg));
  })
  .listen(ASSET_PORT, '127.0.0.1');

// ─────────────────────────────────────────────────────────── CHE DỮ LIỆU THẬT (chặn response ở trình duyệt)
async function patchJson(route, fn) {
  const resp = await route.fetch();
  let body;
  try {
    body = await resp.json();
  } catch {
    await route.fulfill({ response: resp });
    return;
  }
  await route.fulfill({ response: resp, json: fn(body) ?? body });
}
const sumCells = (cells) => {
  const out = {};
  for (const c of cells) for (const [k, v] of Object.entries(c || {})) if (typeof v === 'number') out[k] = (out[k] || 0) + v;
  return out;
};

function rebuildToolCheck(body) {
  const d = body?.data;
  if (!d) return body;
  d.reworkList = (d.reworkList || []).filter((o) => isDemoCode(o.productionId));
  d.unreviewedList = (d.unreviewedList || []).filter((o) => isDemoCode(o.productionId));
  d.errorHistory = (d.errorHistory || []).filter((o) => isDemoCode(o.productionId));
  d.errorCount = d.reworkList.length;
  const rows = new Map((d.days || []).map((r) => [r.day, { day: r.day, total: 0, unreviewed: 0, reviewed: 0, reviewedError: 0, errorByNote: [], reviewedOk: 0, rework: 0 }]));
  let checked = 0;
  for (const o of demoOrders) {
    const r = rows.get(vnDay(o.inProductionAt));
    if (!r) continue;
    const note = o.toolResultNote || '';
    const hist = Array.isArray(o.toolCheckErrorNotes) && o.toolCheckErrorNotes.length ? o.toolCheckErrorNotes : note && note !== 'ok' ? [note] : [];
    r.total++;
    if (!note) r.unreviewed++;
    else {
      r.reviewed++;
      checked++;
      if (hist.length) {
        r.reviewedError++;
        const code = hist[hist.length - 1];
        const hit = r.errorByNote.find((x) => x.code === code);
        if (hit) hit.count++;
        else r.errorByNote.push({ code, count: 1 });
      } else r.reviewedOk++;
    }
    if (o.productionErrorSource === 'tool-check' && note === 'error') r.rework++;
  }
  d.days = [...rows.values()];
  const { day: _d, errorByNote: _e, ...tot } = sumCells(d.days);
  d.columnTotals = { total: 0, unreviewed: 0, reviewed: 0, reviewedError: 0, reviewedOk: 0, rework: 0, ...tot };
  d.checkedCount = checked;
  const scope = [...d.reworkList, ...d.unreviewedList];
  const facet = (key) => Object.entries(scope.reduce((m, o) => (o[key] == null ? m : ((m[String(o[key])] = (m[String(o[key])] || 0) + 1), m)), {})).map(([value, count]) => ({ value, count }));
  d.facets = { type: facet('type'), customer: facet('userSku'), machineNumber: facet('machineNumber'), priority: facet('priority') };
  return body;
}

const DEMO_STAGE_ERRORS = (() => {
  const f = path.join(HERE, 'out/demo-stage-errors.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
})();
const DEMO_STAGE_ERROR_CODES = new Set(DEMO_STAGE_ERRORS.map((e) => e.code));
/** Mã lỗi DEMO theo tên (mã do BE sinh, mỗi máy một số) — dùng để gõ `E-<mã>` như máy quét. */
const demoErrorCode = (stage, name) => {
  const hit = DEMO_STAGE_ERRORS.find((e) => e.stage === stage && e.name === name);
  if (!hit) throw new Error(`Thiếu lỗi DEMO "${name}" (${stage}) trong out/demo-stage-errors.json — chạy seed-demo.mjs`);
  return hit.code;
};
/** Bỏ mọi lỗi CÓ `stage` (danh mục lỗi công đoạn) không thuộc lỗi DEMO — đi đệ quy vì response nhóm theo category. */
function keepDemoStageErrors(node) {
  if (Array.isArray(node)) return node.filter((x) => !(x && typeof x === 'object' && x.stage && x.code && !DEMO_STAGE_ERROR_CODES.has(x.code))).map(keepDemoStageErrors);
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, keepDemoStageErrors(v)]));
  return node;
}

/** Nhãn ghi vào `masked` của ảnh khi response tương ứng đã bị chặn/lọc trên trang đang chụp. Khoá cụ thể đặt TRƯỚC khoá chung. */
const MASK_LABELS = [
  ['overdue-alert', 'Banner quá hạn (tên designer thật) — trả số 0, banner không hiện'],
  ['sidebar-counts', 'Badge số ở sidebar (số toàn hệ thống) — bỏ'],
  // So với `RegExp.source` (dấu "/" bị escape) → khoá không chứa "/".
  ['options(', 'Bộ chọn xưởng ở header — chỉ giữ xưởng DEMO-DTF'],
  ['factories(', 'Danh sách xưởng (tab Xưởng / ô chọn xưởng) — chỉ giữ xưởng DEMO-DTF'],
  ['users(', 'Trang Người dùng — chỉ giữ tài khoản demo.*@example.com (nhân viên thật bị lọc, số user đếm lại)'],
  ['error-log', 'Nhật ký bù lỗi — chỉ giữ đơn DEMO-DTF-* (trang không lọc theo xưởng), đếm lại tổng + mức độ'],
  ['lifecycle-overview', 'Vòng đời đơn — số liệu theo xưởng demo (?factoryId=), danh sách xưởng chỉ giữ DEMO-DTF'],
  ['tool-check-overview', 'Soát tool — chỉ giữ đơn DEMO-DTF-*, KPI / bảng theo ngày / bộ lọc dựng lại từ đơn demo'],
  ['assign-backlog', 'Cần gán designer — chỉ giữ đơn DEMO-DTF-*'],
  ['performance-scores', 'Xếp hạng hiệu suất — chỉ giữ designer demo'],
  ['team-daily-breakdown', 'Designer theo ngày — chỉ giữ designer demo, cộng lại tổng'],
  ['performance', 'Hiệu suất designer — chỉ giữ designer demo'],
  ['breakdown-filters', 'Bộ lọc sản phẩm / khách — chỉ giữ DEMO'],
  ['team(', 'Team Designer — chỉ giữ tài khoản demo'],
  ['workshop-config', 'Danh mục lỗi công đoạn — chỉ giữ lỗi DEMO (lỗi thật dùng chung mọi xưởng bị lọc)'],
];

async function installMasks(context) {
  context.__maskHits = new Set();
  const addRoute = context.route.bind(context);
  const route = (pattern, fn) =>
    addRoute(pattern, (r) => {
      const label = MASK_LABELS.find(([k]) => pattern.source.includes(k))?.[1];
      if (label) context.__maskHits.add(label);
      return fn(r);
    });
  const re = (p) => new RegExp(`/v1/${p}(\\?|$)`);
  await route(re('designer/overdue-alert'), (r) =>
    r.fulfill({ json: { success: true, data: { cutoffDay: '', toolCheckUnreviewed: 0, designerUnassigned: 0, designerBacklog: 0, byDesigner: [] } } }),
  );
  await route(re('designer/sidebar-counts'), (r) => r.fulfill({ json: { success: true, data: null } }));
  await route(re('factories/options'), (r) => patchJson(r, (b) => ({ ...b, data: (b.data || []).filter((f) => f.shortName === DEMO_FACTORY) })));
  await route(re('designer/tool-check-overview'), (r) => patchJson(r, rebuildToolCheck));
  await route(re('users'), (r) =>
    patchJson(r, (b) => {
      const data = (b.data || []).filter((u) => isDemoEmail(u.email));
      return { ...b, data, total: data.length };
    }),
  );
  await route(re('factories'), (r) =>
    patchJson(r, (b) => {
      const data = (b.data || []).filter((f) => f.shortName === DEMO_FACTORY);
      return { ...b, data, total: data.length };
    }),
  );
  // Nhật ký bù lỗi KHÔNG lọc theo ?factoryId (A6) → chỉ giữ đơn demo, đếm lại mức độ theo cùng ngưỡng ErrorLogTab.urgencyOf.
  await route(re('orders/error-log'), (r) =>
    patchJson(r, (b) => {
      const data = (b.data || []).filter((o) => isDemoCode(o.productionId));
      const byUrgency = { new: 0, attention: 0, urgent: 0, critical: 0 };
      for (const o of data) {
        const h = (Date.now() - new Date(o.inProductionAt || Date.now()).getTime()) / 3600e3;
        byUrgency[h < 2 ? 'new' : h < 4 ? 'attention' : h < 6 ? 'urgent' : 'critical']++;
      }
      return { ...b, data, total: data.length, byUrgency };
    }),
  );
  // Vòng đời đơn: số liệu CHỈ an toàn khi có ?factoryId=<xưởng demo>. Thiếu → đánh dấu, shot() từ chối chụp.
  await route(re('orders/lifecycle-overview'), (r) => {
    const fid = new URL(r.request().url()).searchParams.get('factoryId');
    if (fid !== demoFactoryId) context.__unscoped = `lifecycle-overview factoryId=${fid ?? '(trống)'}`;
    return patchJson(r, (b) =>
      b?.data ? { ...b, data: { ...b.data, factories: (b.data.factories || []).filter((f) => f.factoryId === demoFactoryId) } } : b,
    );
  });
  await route(re('designer/assign-backlog'), (r) =>
    patchJson(r, (b) => {
      if (!b?.data) return b;
      const groups = (b.data.groups || [])
        .map((g) => {
          const orders = (g.orders || []).filter((o) => isDemoCode(o.productionId));
          return { ...g, orders, orderIds: orders.map((o) => o._id), count: orders.length };
        })
        .filter((g) => g.count > 0);
      return { ...b, data: { ...b.data, groups, total: groups.reduce((s, g) => s + g.count, 0) } };
    }),
  );
  await route(re('designer/team'), (r) =>
    patchJson(r, (b) => {
      const data = (b.data || []).filter((m) => isDemoEmail(m.email));
      return { ...b, data, total: data.length };
    }),
  );
  await route(re('designer/performance-scores'), (r) => patchJson(r, (b) => ({ ...b, data: { ...b.data, rows: (b.data?.rows || []).filter((x) => demoUserIds.has(String(x.userId))) } })));
  await route(re('designer/performance'), (r) =>
    patchJson(r, (b) => ({ ...b, data: Array.isArray(b.data) ? b.data.filter((x) => demoUserIds.has(String(x.userId ?? x._id ?? x.assignee))) : b.data })),
  );
  await route(re('designer/team-daily-breakdown'), (r) =>
    patchJson(r, (b) => {
      if (!b?.data) return b;
      const rows = (b.data.rows || []).filter((x) => demoUserIds.has(String(x.userId)));
      const columnTotals = (b.data.days || []).map((_, i) => sumCells(rows.map((x) => x.cells?.[i])));
      return { ...b, data: { ...b.data, rows, columnTotals, grandTotals: sumCells(rows.map((x) => x.totals)) } };
    }),
  );
  // Danh mục lỗi công đoạn dùng chung MỌI xưởng → chỉ giữ lỗi DEMO (mã lấy từ seed) ở mọi response workshop-config;
  // lỗi CHUNG (không `stage`: "Thiếu file để in", "In lệch"…) giữ nguyên vì là dữ liệu cấu hình, không phải dữ liệu thật của đơn.
  await route(/\/v1\/workshop-config(\/|\?|$)/, (r) => patchJson(r, (b) => keepDemoStageErrors(b)));
  await route(re('designer/breakdown-filters'), (r) =>
    patchJson(r, (b) => ({
      ...b,
      data: {
        products: (b.data?.products || []).filter((x) => x.value === DEMO_PRODUCT),
        customers: (b.data?.customers || []).filter((x) => x.value === DEMO_SKU),
      },
    })),
  );
}

/** Ẩn khối có tiêu đề bắt đầu bằng 1 trong `titles` (số toàn nhà máy). Trả danh sách đã ẩn để ghi manifest. */
async function hideSections(page, titles) {
  return page.evaluate((titles) => {
    const hidden = [];
    // CHỈ trong <main> (không đụng sidebar/header — link sidebar cùng tên như "Vòng đời đơn" từng bị ẩn nhầm).
    // So bằng text node TRỰC TIẾP của phần tử (tiêu đề có icon SVG kèm vẫn khớp), leo lên thẻ `.bg-card` gần nhất.
    for (const el of document.querySelectorAll('main *')) {
      const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
      const hit = t && titles.find((x) => t.startsWith(x));
      if (!hit) continue;
      const card = el.closest('.bg-card');
      // Khối đã ẩn ở ảnh trước vẫn tính vào `masked` của ảnh này (trường masked mô tả TỪNG ảnh).
      if (card && card.closest('main') && !card.closest('[role="dialog"]')) {
        card.style.display = 'none';
        hidden.push(hit);
      }
    }
    return [...new Set(hidden)];
  }, titles);
}

// ─────────────────────────────────────────────────────────── CHỤP (khuôn TASK-01)
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.DTF_CHANNEL || 'chrome', headless: true });
const converterCtx = await browser.newContext();
const converter = await converterCtx.newPage();
const manifest = [];

const pct = (v) => Math.round(v * 1000) / 10;

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
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (buf.length <= MAX_BYTES || q <= 0.4) return buf;
    q -= 0.08;
  }
}

async function inkGrid(page, box) {
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
  grid.bits.forEach((b, i) => {
    if (b) bytes[i >> 3] |= 1 << (i & 7);
  });
  return { cell: INK_CELL, cols: grid.cols, rows: grid.rows, data: bytes.toString('base64') };
}

async function rawUnion(locators) {
  const boxes = [];
  for (const l of locators) {
    const b = await l.first().boundingBox();
    if (!b) throw new Error(`Không lấy được boundingBox: ${l}`);
    boxes.push(b);
  }
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

async function settle(page, extra = 700) {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

/**
 * Khung app cố định (MainLayout): chỉ `<main>` cuộn, sidebar/header đứng yên. Đặt đỉnh `locator` cách đỉnh `<main>` `offset` px.
 * Phần tử trong dialog/popover (không nằm trong main) → không làm gì.
 */
async function scrollMainTo(page, locator, offset = 16) {
  await locator.first().evaluate((el, off) => {
    const main = el.closest('main');
    if (!main) return;
    main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - off;
  }, offset);
  await page.waitForTimeout(250);
}

/**
 * `clip`: 'viewport' | Locator[]; `pad`: số px mọi phía HOẶC `{ top, right, bottom, left }` (thiếu phía nào = 16) — chừa lề
 * rộng ở phía TRỐNG khi ảnh nhỏ, để huy hiệu số có chỗ đứng ngoài viền (DtfRoleGuide.md §6.4);
 * `scrollTo`: Locator (ảnh viewport) — cuộn main tới trước khi đo; `callouts`: [{ target, label?, detail, also? }].
 */
async function shot(page, { role, step, key, shows, clip = 'viewport', pad = 16, scrollTo, scrollOffset = 16, callouts, masked = [] }) {
  if (page.context().__unscoped) throw new Error(`[${role}/${key}] TỪ CHỐI CHỤP: response chưa lọc theo xưởng demo (${page.context().__unscoped})`);
  const pads = typeof pad === 'number' ? { top: pad, right: pad, bottom: pad, left: pad } : { top: 16, right: 16, bottom: 16, left: 16, ...pad };
  if (scrollTo) await scrollMainTo(page, scrollTo, scrollOffset);
  else if (clip !== 'viewport') await scrollMainTo(page, clip[0], pads.top);
  if (ONLY_SHOTS.size && !ONLY_SHOTS.has(`${role}/${key}`)) {
    process.stdout.write(`  bỏ qua ${role}/${key} (không nằm trong --shots)\n`);
    return;
  }
  const vp = page.viewportSize() ?? VIEWPORT;
  let box = { x: 0, y: 0, ...vp };
  if (clip !== 'viewport') {
    const u = await rawUnion(clip);
    const x = Math.max(0, Math.floor(u.x - pads.left));
    const y = Math.max(0, Math.floor(u.y - pads.top));
    box = { x, y, width: Math.min(vp.width, Math.ceil(u.x + u.width + pads.right)) - x, height: Math.min(vp.height, Math.ceil(u.y + u.height + pads.bottom)) - y };
  }
  const notes = [];
  for (const [i, c] of callouts.entries()) {
    const loc = c.target.first();
    const b = await loc.boundingBox();
    if (!b) throw new Error(`[${role}/${key}] chú thích ${i + 1} không có boundingBox`);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    if (cx < box.x || cx > box.x + box.width || cy < box.y || cy > box.y + box.height) {
      const r = (v) => Math.round(v);
      throw new Error(`[${role}/${key}] chú thích ${i + 1} nằm ngoài vùng chụp — tâm (${r(cx)},${r(cy)}) · vùng ${r(box.x)},${r(box.y)} ${r(box.width)}×${r(box.height)}`);
    }
    const hit = await loc.evaluate((el, [x, y]) => {
      const at = document.elementFromPoint(x, y);
      return !!at && (el === at || el.contains(at) || at.contains(el));
    }, [cx, cy]);
    if (!hit) throw new Error(`[${role}/${key}] chú thích ${i + 1} bị che hoặc đã cuộn khuất`);
    const u = c.also?.length ? await rawUnion([loc, ...c.also]) : b;
    const bx0 = Math.max(box.x, u.x - BOX_PAD);
    const by0 = Math.max(box.y, u.y - BOX_PAD);
    const bx1 = Math.min(box.x + box.width, u.x + u.width + BOX_PAD);
    const by1 = Math.min(box.y + box.height, u.y + u.height + BOX_PAD);
    notes.push({
      n: i + 1,
      xPct: pct((cx - box.x) / box.width),
      yPct: pct((cy - box.y) / box.height),
      boxPct: { x: pct((bx0 - box.x) / box.width), y: pct((by0 - box.y) / box.height), w: pct((bx1 - bx0) / box.width), h: pct((by1 - by0) / box.height) },
      label: c.label ?? (await loc.innerText()).replace(/\s+/g, ' ').trim(),
      detail: c.detail,
    });
  }
  const ink = await inkGrid(page, box);
  const png = await page.screenshot({ clip: box, type: 'png', animations: 'disabled', caret: 'hide' });
  const buf = await toWebp(png);
  fs.mkdirSync(path.join(OUT, role), { recursive: true });
  const file = `${role}/${key}.webp`;
  fs.writeFileSync(path.join(OUT, file), buf);
  const u = new URL(page.url());
  // masked = khối bị ẩn / chữ bị đổi (truyền vào) + mọi response đã bị lọc trên trang này (installMasks ghi nhận).
  masked = [...new Set([...masked, ...(page.context().__maskHits || [])])];
  manifest.push({ role, step, file, width: box.width, height: box.height, screen: u.pathname + u.search, shows, masked, callouts: notes, ink });
  console.log(`  shot ${file} ${box.width}×${box.height} ${(buf.length / 1024).toFixed(0)} KB${masked.length ? ` · che: ${masked.join(', ')}` : ''}`);
}

async function newRolePage(_role) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', colorScheme: 'light' });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('onosfactory-language', JSON.stringify({ state: { language: 'vi' }, version: 0 }));
      localStorage.setItem('printera-theme', JSON.stringify({ state: { mode: 'light' }, version: 0 }));
    } catch {
      /* bỏ qua */
    }
    const put = () => {
      const s = document.createElement('style');
      s.textContent = '*{caret-color:transparent!important} [data-sonner-toaster]{visibility:hidden!important}';
      document.head.appendChild(s);
    };
    if (document.head) put();
    else document.addEventListener('DOMContentLoaded', put);
  });
  await installMasks(context);
  openContexts.add(context);
  const page = await context.newPage();
  return { context, page };
}
/** Context mở của lượt chụp đang chạy — đóng hết nếu vai lỗi giữa chừng (để thử lại sạch). */
const openContexts = new Set();

async function uiLogin(page, email, { captureAs } = {}) {
  page.context().__maskHits?.clear();
  await page.goto(`${WEB}/adm/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').waitFor({ timeout: 60000 });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  await settle(page, 400);
  if (captureAs) await captureAs();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.waitForURL(/\/ffm\//, { timeout: 60000 });
  await settle(page);
}

const go = async (page, p) => {
  page.context().__maskHits?.clear(); // tải trang mới → chỉ ghi các response bị lọc của trang này
  page.context().__unscoped = undefined;
  await page.goto(WEB + p, { waitUntil: 'domcontentloaded' });
  await settle(page, 900);
};
const GLOBAL_HIDE = ['Vòng đời đơn'];

/** Ô trong bảng theo tiêu đề cột (bảng thật có <th>). */
async function cellByHeader(row, header) {
  const table = row.locator('xpath=ancestor::table[1]');
  // textContent, KHÔNG innerText: tiêu đề cột có CSS `uppercase` → innerText trả "NOTE KQ TOOL 1".
  const heads = await table.locator('thead th').evaluateAll((ths) => ths.map((th) => th.textContent || ''));
  const idx = heads.findIndex((h) => h.replace(/\s+/g, ' ').trim().startsWith(header));
  if (idx < 0) throw new Error(`Không thấy cột "${header}"`);
  return row.locator('td').nth(idx);
}

// ─────────────────────────────────────────────────────────── VAI: SUPPORT
async function captureSupport() {
  const role = 'support';
  const { context, page } = await newRolePage(role);
  await uiLogin(page, ROLE_ACCOUNTS.support, {
    captureAs: () =>
      shot(page, {
        role, step: 1, key: '01-login',
        shows: 'Màn đăng nhập hệ thống xưởng: nhập email và mật khẩu tài khoản nhân viên.',
        clip: [page.locator('form')], pad: 40,
        callouts: [
          { target: page.locator('input[name="email"]'), label: 'Email', detail: 'Email tài khoản nhân viên.' },
          { target: page.locator('input[name="password"]'), label: 'Mật khẩu', detail: 'Mật khẩu đăng nhập.' },
          { target: page.getByRole('button', { name: 'Tiếp tục' }), detail: 'Vào hệ thống — Support về trang Dashboard.' },
        ],
      }),
  });

  await go(page, '/ffm/dashboard?tab=tool-check');
  const btnUnreviewed = page.getByRole('button', { name: /^Chưa soát \(\d+\)$/ });
  const btnRework = page.getByRole('button', { name: /^Cần làm lại \(\d+\)$/ });
  await btnUnreviewed.waitFor({ timeout: 60000 });
  let masked = await hideSections(page, GLOBAL_HIDE);
  await shot(page, {
    role, step: 2, key: '02-tool-check-overview', masked,
    // Khối Soát tool dài hơn 1 màn: cuộn để bộ lọc kỳ lên gần đỉnh, thẻ KPI + nút danh sách vẫn trong khung.
    scrollTo: page.getByRole('button', { name: '7 ngày', exact: true }).first(), scrollOffset: 60,
    shows: 'Tab Soát tool: thẻ số liệu trong kỳ, dải tổng quan theo ngày vào sản xuất và 2 danh sách việc cần làm.',
    callouts: [
      { target: page.locator('a', { hasText: 'Soát tool' }).first(), detail: 'Menu Dashboard › Soát tool.' },
      { target: page.getByText('In trả về (cần làm lại)', { exact: true }).first(), detail: 'Số đơn công nhân In trả về vì thiếu file — làm trước.' },
      { target: btnUnreviewed, detail: 'Danh sách đơn chưa có Note kq Tool.' },
      { target: page.getByRole('button', { name: '7 ngày', exact: true }).first(), detail: 'Kỳ xem theo ngày vào sản xuất, mặc định 7 ngày.' },
    ],
  });

  await btnUnreviewed.click();
  const row01 = page.locator('tr', { hasText: `${DEMO_PREFIX}01` }).first();
  await row01.waitFor({ timeout: 30000 });
  await row01.scrollIntoViewIfNeeded();
  await settle(page, 500);
  masked = await hideSections(page, GLOBAL_HIDE);
  const table = row01.locator('xpath=ancestor::table[1]');
  await shot(page, {
    role, step: 3, key: '03-unreviewed-list', masked,
    shows: 'Danh sách "Chưa soát": mỗi dòng một đơn, sửa trực tiếp Note kq Tool 1, File sửa lỗi và ghi chú.',
    callouts: [
      { target: row01.getByText(`${DEMO_PREFIX}01`, { exact: true }).first(), detail: 'Mã sản xuất của đơn (bấm biểu tượng bên cạnh để chép).' },
      { target: table.locator('thead th', { hasText: 'Note kq Tool 1' }), detail: 'Kết quả soát: Ok / Lỗi / Không có file PDF / Không có tool.' },
      { target: table.locator('thead th', { hasText: 'File sửa lỗi' }), detail: 'Chọn vị trí file cần designer sửa.' },
      { target: table.locator('thead th', { hasText: 'Ghi chú file lỗi' }), detail: 'Mô tả ngắn lỗi file cho designer.' },
    ],
  });

  const noteCell = await cellByHeader(row01, 'Note kq Tool 1');
  await noteCell.locator('button').first().click();
  const pop = page.getByRole('dialog').last();
  await pop.getByRole('button', { name: 'Ok', exact: true }).waitFor({ timeout: 10000 });
  await settle(page, 300);
  masked = await hideSections(page, GLOBAL_HIDE);
  await shot(page, {
    role, step: 4, key: '04-note-options', masked,
    shows: 'Bấm ô Note kq Tool 1 để chọn kết quả soát. Ok cho đơn đi thẳng In; Lỗi đưa đơn vào hàng chờ gán designer.',
    callouts: [
      { target: pop.getByRole('button', { name: 'Ok', exact: true }), detail: 'Đủ file in — đơn sang công đoạn In ngay.' },
      { target: pop.getByRole('button', { name: 'Lỗi', exact: true }), detail: 'File cần thiết kế lại — đơn vào "Cần gán designer".' },
      { target: pop.getByRole('button', { name: 'Không có file PDF', exact: true }), detail: 'Thiếu file PDF — cũng chờ gán designer.' },
    ],
  });
  await page.keyboard.press('Escape');

  await btnRework.click();
  const row12 = page.locator('tr', { hasText: `${DEMO_PREFIX}12` }).first();
  await row12.waitFor({ timeout: 30000 });
  await row12.scrollIntoViewIfNeeded();
  await settle(page, 500);
  masked = await hideSections(page, GLOBAL_HIDE);
  await shot(page, {
    role, step: 5, key: '05-rework-list', masked,
    shows: 'Danh sách "Cần làm lại": đơn công nhân In báo "Thiếu file để in". Soát lại rồi đổi Note về Ok, hoặc bấm "Đã soát xong" để chuyển designer.',
    callouts: [
      { target: row12.getByText(`${DEMO_PREFIX}12`, { exact: true }).first(), detail: 'Đơn bị In trả về.' },
      { target: await cellByHeader(row12, 'Lỗi xưởng'), label: 'Lỗi xưởng', detail: 'Lỗi công nhân In đã báo.' },
      { target: await cellByHeader(row12, 'Note kq Tool 1'), label: 'Note kq Tool 1', detail: 'File thật ra đủ → đổi về Ok, đơn quay lại In.' },
      { target: row12.getByRole('button', { name: 'Đã soát xong' }), detail: 'Cần thiết kế lại → chuyển designer (cũ / tự gán / hàng chờ).' },
    ],
  });

  await go(page, `/ffm/orders/workshop?factoryId=${encodeURIComponent(demoFactoryId)}`);
  // Bảng xưởng gom đơn theo loại sản phẩm, nhóm mặc định THU GỌN → bấm dòng nhóm để mở.
  const groupCell = page.locator('td', { has: page.getByText(DEMO_PRODUCT, { exact: true }) }).first();
  await groupCell.waitFor({ timeout: 60000 });
  if (!(await page.locator('tr', { hasText: `${DEMO_PREFIX}13` }).count())) await groupCell.click();
  // Bảng ẢO HOÁ (chỉ dựng dòng trong vùng nhìn thấy) → cuộn vùng cuộn của bảng từng nấc tới khi dòng 13 được dựng.
  for (let i = 0; i < 40 && !(await page.locator('tr', { hasText: `${DEMO_PREFIX}13` }).count()); i++) {
    await groupCell.evaluate((td) => {
      let s = td.parentElement;
      while (s && !(s.scrollHeight > s.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      if (s) s.scrollTop += 300;
    });
    await page.waitForTimeout(250);
  }
  const row13 = page.locator('tr', { hasText: `${DEMO_PREFIX}13` }).first();
  await row13.waitFor({ timeout: 60000 });
  await row13.hover();
  await row13.getByRole('button', { name: 'Thao tác đơn' }).click();
  await page.getByRole('menuitem', { name: 'Giữ đơn' }).click();
  const holdDlg = page.getByRole('dialog').filter({ hasText: 'Giữ đơn' }).last();
  await holdDlg.waitFor({ timeout: 10000 });
  const preset = holdDlg.getByRole('button', { name: 'Chờ khách xác nhận', exact: true });
  await preset.click();
  await settle(page, 300);
  await shot(page, {
    role, step: 6, key: '06-hold-dialog',
    shows: 'Giữ đơn từ menu "…" ở Danh sách đơn: chọn lý do có sẵn hoặc tự gõ. Đơn giữ bị khoá mọi thao tác tới khi mở lại.',
    clip: [holdDlg], pad: 24,
    callouts: [
      { target: preset, detail: 'Lý do có sẵn — bấm để điền nhanh.' },
      { target: holdDlg.locator('textarea'), label: 'Lý do giữ', detail: 'Có thể sửa hoặc tự gõ lý do (không bắt buộc).' },
      { target: holdDlg.getByRole('button', { name: 'Giữ đơn', exact: true }), detail: 'Xác nhận giữ đơn.' },
    ],
  });
  await holdDlg.getByRole('button', { name: 'Đóng' }).click();
  await context.close();
}

// ─────────────────────────────────────────────────────────── VAI: DESIGNER LEADER
async function captureLeader() {
  const role = 'designer-leader';
  const { context, page } = await newRolePage(role);
  await uiLogin(page, ROLE_ACCOUNTS[role]);
  // `?factoryId=` bắt buộc: dải "Vòng đời đơn" trên đầu Dashboard gọi lifecycle-overview theo phạm vi URL — thiếu thì
  // `shot()` từ chối chụp (số toàn nhà máy). Khối "Cần gán designer" KHÔNG lọc theo xưởng (services/designer.ts assignBacklog).
  await go(page, `/ffm/dashboard?tab=designer&factoryId=${encodeURIComponent(demoFactoryId)}`);
  const section = page.locator('div.rounded-lg', { has: page.getByText('Cần gán designer', { exact: true }) }).first();
  await section.waitFor({ timeout: 60000 });
  let masked = await hideSections(page, [...GLOBAL_HIDE, 'Tổng quan 7 ngày']);
  await section.scrollIntoViewIfNeeded();
  await settle(page, 500);
  await shot(page, {
    role, step: 1, key: '01-assign-backlog', masked,
    shows: 'Khối "Cần gán designer" ở tab Designer: đơn đã soát lỗi chưa có ai nhận, gom theo sản phẩm.',
    // Ô tick nhóm nằm sát mép trái khối, kẹp giữa tiêu đề (trên) và ảnh mockup (phải): lề 16px đều khiến huy hiệu #2
    // chỉ còn chỗ đè lên mockup. Chừa lề TRÁI (vùng trống ngoài khối) cho huy hiệu; dưới giữ 16 — rộng hơn là lộ mép khối
    // "Tất cả designer theo ngày" bên dưới.
    clip: [section], pad: { top: 16, right: 16, bottom: 16, left: 44 },
    callouts: [
      { target: section.getByText('Cần gán designer', { exact: true }), detail: 'Tổng số đơn đang chờ gán.' },
      { target: section.locator('input[type=checkbox]').first(), label: 'Chọn cả nhóm', detail: 'Tick để chọn mọi đơn của sản phẩm.' },
      { target: section.getByRole('button', { name: /^Gán design/ }), detail: 'Gán các đơn đã chọn cho 1 designer.' },
      { target: section.getByRole('button', { name: /^Tự động gán/ }), detail: 'Chia theo cấu hình tự động gán (xưởng chưa cấu hình thì không gán được).' },
    ],
  });

  await section.getByRole('button', { name: DEMO_PRODUCT }).first().click();
  const r04 = section.locator('tr', { hasText: `${DEMO_PREFIX}04` }).first();
  await r04.waitFor({ timeout: 30000 });
  await r04.locator('input[type=checkbox]').first().check();
  await section.locator('tr', { hasText: `${DEMO_PREFIX}05` }).first().locator('input[type=checkbox]').first().check();
  await settle(page, 400);
  // Nhóm mở ra nằm trong vùng cuộn riêng (max-h 80vh, mỗi dòng ~178px) và 04/05 không nằm đầu nhóm →
  // đẩy dòng 04 lên ngay dưới tiêu đề bảng của vùng cuộn đó (tiêu đề khối "Cần gán designer" nằm ngoài, vẫn đứng yên).
  await scrollMainTo(page, section, 16);
  await r04.evaluate((el) => {
    const box = el.closest('.overflow-y-auto');
    if (box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 36;
  });
  await page.waitForTimeout(300);
  masked = await hideSections(page, [...GLOBAL_HIDE, 'Tổng quan 7 ngày']);
  await shot(page, {
    role, step: 2, key: '02-select-orders', masked,
    shows: 'Mở nhóm sản phẩm, tick từng đơn cần gán; nút gán cho biết số đơn đang chọn.',
    clip: [section], pad: 16,
    callouts: [
      { target: r04.locator('input[type=checkbox]').first(), label: 'Ô chọn đơn', detail: 'Tick từng đơn.' },
      { target: section.getByRole('button', { name: /^Gán design \(2\)/ }), detail: 'Gán 2 đơn đã chọn cho designer.' },
      { target: section.getByRole('button', { name: /^Nhận về mình \(2\)/ }), detail: 'Leader tự nhận làm.' },
    ],
  });

  await section.getByRole('button', { name: /^Gán design \(2\)/ }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: 'Gán designer cho' }).last();
  await dlg.waitFor({ timeout: 15000 });
  const sel = dlg.locator('select').first();
  const optA = await sel.locator('option', { hasText: 'Demo Designer A' }).first().getAttribute('value');
  if (optA) await sel.selectOption(optA);
  await settle(page, 400);
  await shot(page, {
    role, step: 3, key: '03-assign-dialog',
    shows: 'Hộp gán designer: xem trạng thái các đơn đã chọn, chọn designer (kèm số đơn đang ôm) rồi bấm Gán.',
    clip: [dlg], pad: 24,
    callouts: [
      { target: dlg.getByText('Trạng thái hiện tại:').first(), detail: 'Đơn đang làm / đã xong / đã Ok sẽ tự bị bỏ qua.' },
      { target: sel, label: 'Gán cho designer', detail: 'Chọn người đang ôm ít đơn.' },
      { target: dlg.getByRole('button', { name: /^(Gán|Ghi đè & Gán)$/ }), detail: 'Xác nhận gán.' },
    ],
  });
  await dlg.getByRole('button', { name: 'Hủy' }).click();

  await go(page, '/ffm/designer/team');
  const addBtn = page.getByRole('button', { name: 'Thêm sub-designer' });
  await addBtn.waitFor({ timeout: 60000 });
  const rowA = page.locator('tr', { hasText: 'Demo Designer A' }).first();
  await rowA.waitFor({ timeout: 30000 });
  await shot(page, {
    role, step: 4, key: '04-designer-team',
    shows: 'Trang Team Designer: thêm designer, bật/tắt, đặt lại mật khẩu; lọc người đang bật/đã tắt.',
    callouts: [
      { target: addBtn, detail: 'Tạo tài khoản designer mới.' },
      { target: rowA.getByRole('switch').first(), label: 'Bật/Tắt', detail: 'Tắt người nghỉ — không gán được đơn mới (còn task đang làm thì không tắt được).' },
      { target: rowA.locator('button[title="Reset mật khẩu"]'), label: 'Reset mật khẩu', detail: 'Đặt lại mật khẩu cho designer.' },
      { target: page.getByRole('button', { name: 'Đang bật', exact: true }).first(), detail: 'Lọc danh sách theo trạng thái.' },
    ],
  });

  await go(page, `/ffm/dashboard?tab=designer&factoryId=${encodeURIComponent(demoFactoryId)}`);
  const matrix = page.locator('div.rounded-xl, div.rounded-lg', { has: page.getByText('Tất cả designer theo ngày') }).last();
  await matrix.waitFor({ timeout: 60000 });
  masked = await hideSections(page, [...GLOBAL_HIDE, 'Tổng quan 7 ngày']);
  await matrix.scrollIntoViewIfNeeded();
  await settle(page, 500);
  await shot(page, {
    role, step: 5, key: '05-team-matrix', masked,
    shows: 'Bảng "Tất cả designer theo ngày": số đơn mỗi designer theo ngày vào sản xuất — thấy ai đang tồn nhiều.',
    clip: [matrix], pad: 16,
    callouts: [
      { target: matrix.getByText('Tất cả designer theo ngày').first(), detail: 'Ma trận designer × ngày.' },
      { target: matrix.getByText('Demo Designer A').first(), detail: 'Một dòng = một designer.' },
    ],
  });
  await context.close();
}

// ─────────────────────────────────────────────────────────── VAI: DESIGNER
async function captureDesigner() {
  const role = 'designer';
  const { context, page } = await newRolePage(role);
  await uiLogin(page, ROLE_ACCOUNTS[role]);
  if (!/\/ffm\/my-tasks/.test(page.url())) await go(page, '/ffm/my-tasks');
  const hello = page.getByText(/^Xin chào/).first();
  await hello.waitFor({ timeout: 60000 });
  const idBtn = (n) => page.getByRole('button', { name: `${DEMO_PREFIX}${n}`, exact: true }).first();
  await idBtn('07').waitFor({ timeout: 60000 });
  const HIDE = [...GLOBAL_HIDE, 'Tổng quan theo ngày'];
  let masked = await hideSections(page, HIDE);
  await settle(page, 400);
  await shot(page, {
    role, step: 1, key: '01-my-tasks', masked,
    shows: 'Trang Task của tôi: kỳ theo ngày vào sản xuất, chi tiết theo ngày và bảng kanban việc của riêng bạn.',
    callouts: [
      { target: hello, detail: 'Trang việc của chính designer đang đăng nhập.' },
      { target: page.getByRole('button', { name: '7 ngày', exact: true }).first(), detail: 'Kỳ mặc định 7 ngày.' },
      { target: page.getByText('Chi tiết theo ngày').first(), detail: 'Số đơn chưa xong theo từng ngày — ngày cũ còn tồn làm trước.' },
      { target: page.getByPlaceholder('productionId / orderId').first(), label: 'Tìm', detail: 'Tìm nhanh theo mã.' },
    ],
  });

  // Vỏ ngoài của thẻ (`my-tasks/index.tsx` ~1146): chứa ô tick, TaskCard VÀ nút "KLĐ" (absolute, hiện khi rê chuột).
  // KHÔNG lấy div.rounded gần nhất — đó là TaskCard, không chứa nút KLĐ.
  const cardOf = (n) => idBtn(n).locator('xpath=ancestor::div[contains(@class,"transition-opacity") and contains(concat(" ",@class," ")," group ")][1]');
  const card07 = cardOf('07');
  masked = await hideSections(page, HIDE);
  // Cuộn TRƯỚC rồi mới rê chuột: shot() cuộn main tới clip → nếu cuộn sau khi hover, con trỏ rơi sang thẻ bên dưới
  // và nút "KLĐ" (chỉ hiện khi rê chuột) hiện nhầm ở thẻ khác.
  await scrollMainTo(page, card07, 12);
  await card07.hover();
  await settle(page, 300);
  await shot(page, {
    role, step: 2, key: '02-task-card', masked,
    shows: 'Thẻ đơn ở cột Cần làm: ảnh mockup, mã sản xuất, kết quả soát tool. Đổi trạng thái bằng kéo thả hoặc tick + thanh công cụ.',
    // Thẻ chỉ ~170px mà có 4 chú thích sát nhau: lề 12px đều khiến huy hiệu "KLĐ" rơi vào viền mã sản xuất. Chừa lề
    // TRÁI (khoảng trống trong cột "Cần làm") + PHẢI (khe giữa 2 cột); trên/dưới giữ sát vì có dòng nhóm và thẻ 08.
    clip: [card07], pad: { top: 12, right: 44, bottom: 12, left: 36 },
    // 3 chú thích, KHÔNG gắn riêng nhãn "Lỗi" (Note kq Tool): nhãn kẹp giữa mockup, mã sản xuất và "KLĐ" nên huy hiệu của nó
    // chỉ còn chỗ đè lên chính chữ "Lỗi" (DEV-11). Nghĩa của nhãn gộp vào chú thích #1.
    callouts: [
      { target: idBtn('07'), detail: 'Bấm mã để xem chi tiết đơn và file. Nhãn đỏ phía trên (vd "Lỗi") là kết quả Support đã soát.' },
      { target: card07.locator('img').first(), label: 'Mockup', detail: 'Bấm để xem ảnh lớn.' },
      { target: card07.getByRole('button', { name: 'KLĐ' }), label: 'KLĐ', detail: 'Không làm được — bàn giao cho designer khác.' },
    ],
  });

  await idBtn('07').click();
  const detail = page.getByRole('dialog').last();
  await detail.getByRole('button', { name: 'Đóng' }).first().waitFor({ timeout: 20000 });
  await settle(page, 600);
  // File design demo trỏ asset nội bộ 127.0.0.1:<port> — đổi CHỮ hiển thị thành link Drive mẫu (khuôn TASK-01), href giữ nguyên.
  const relinked = await detail.evaluate((root, port) => {
    let n = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const m = t.nodeValue.match(new RegExp(`https?://127\\.0\\.0\\.1:${port}/(dtf-[\\w-]+)\\.svg`));
      if (m) {
        t.nodeValue = t.nodeValue.replace(m[0], `https://drive.google.com/file/d/${m[1]}`);
        n++;
      }
    }
    return n;
  }, ASSET_PORT);
  await shot(page, {
    role, step: 3, key: '03-task-detail',
    masked: relinked ? [`Đổi chữ ${relinked} link file design (asset demo nội bộ 127.0.0.1) thành link Drive mẫu`] : [],
    shows: 'Chi tiết đơn: thông tin sản phẩm, mockup, file design, file cần sửa và dòng thời gian.',
    clip: [detail], pad: 16,
    callouts: [
      { target: detail.getByText(/^File design/).first(), detail: 'Các file design của đơn.' },
      { target: detail.getByText('File sửa lỗi').first(), detail: 'Vị trí file Support yêu cầu sửa + ghi chú.' },
      { target: detail.getByText('Timeline designer').first(), detail: 'Gán lúc nào, bắt đầu, hoàn thành.' },
    ],
  });
  await detail.getByRole('button', { name: 'Đóng' }).first().click();

  const tick = (card) => card.locator('input[type=checkbox]').first();
  await tick(card07).check();
  await settle(page, 300);
  const bar = page.getByText(/^Đã chọn \d+/).first();
  masked = await hideSections(page, HIDE);
  await shot(page, {
    role, step: 4, key: '04-start-bulk', masked,
    shows: 'Tick thẻ ở cột Cần làm → thanh công cụ hiện nút Nhận làm (tương đương kéo thẻ sang Đang làm).',
    callouts: [
      { target: tick(card07), label: 'Ô chọn thẻ', detail: 'Shift + bấm để chọn liền nhiều thẻ.' },
      { target: page.getByRole('button', { name: 'Nhận làm', exact: true }), detail: 'Bắt đầu làm các đơn đã chọn.' },
      { target: bar, detail: 'Số thẻ đang chọn.' },
    ],
  });
  await tick(card07).uncheck();

  const card09 = cardOf('09');
  await card09.scrollIntoViewIfNeeded();
  await tick(card09).check();
  await settle(page, 300);
  masked = await hideSections(page, HIDE);
  await shot(page, {
    role, step: 5, key: '05-complete-bulk', masked,
    shows: 'Tick thẻ ở cột Đang làm → Hoàn thành. Đơn tự thành Note Ok và sang công đoạn In.',
    callouts: [
      { target: card09, label: 'Thẻ đang làm', detail: 'Đơn đã làm xong file.' },
      { target: page.getByRole('button', { name: 'Hoàn thành', exact: true }), detail: 'Hoàn thành — đơn chuyển cho công nhân In.' },
    ],
  });
  await tick(card09).uncheck();

  const card11 = cardOf('11');
  await card11.scrollIntoViewIfNeeded();
  await settle(page, 300);
  masked = await hideSections(page, HIDE);
  await shot(page, {
    role, step: 6, key: '06-rework-card', masked,
    shows: 'Cột Cần làm lại: đơn xưởng báo lỗi thiết kế, khối vàng ghi mô tả lỗi. Kéo sang Đang làm để làm lại.',
    clip: [card11], pad: 48,
    callouts: [
      { target: card11.getByText(/DEMO — /).first(), label: 'Mô tả lỗi xưởng', detail: 'Lỗi xưởng báo — sửa đúng chỗ này.' },
      { target: idBtn('11'), detail: 'Làm xong, đơn vào cột "Đã sửa".' },
    ],
  });

  const card28 = cardOf('28');
  await card28.scrollIntoViewIfNeeded();
  await settle(page, 300);
  masked = await hideSections(page, HIDE);
  await shot(page, {
    role, step: 7, key: '07-watching', masked,
    shows: 'Cột Đang chờ quay lại: đơn bạn đã làm xong nhưng công nhân In trả về Support vì thiếu file — chờ Support soát xong.',
    clip: [card28], pad: 48,
    callouts: [
      { target: idBtn('28'), detail: 'Chưa tới lượt bạn; Support soát xong đơn tự về Cần làm lại.' },
    ],
  });

  const card08 = cardOf('08');
  await card08.scrollIntoViewIfNeeded();
  await card08.hover();
  await card08.getByRole('button', { name: 'KLĐ' }).click();
  const rej = page.getByRole('dialog').filter({ hasText: 'Báo file không làm được' }).last();
  await rej.waitFor({ timeout: 15000 });
  const rsel = rej.locator('select').first();
  const optB = await rsel.locator('option', { hasText: 'Demo Designer B' }).first().getAttribute('value');
  if (optB) await rsel.selectOption(optB);
  await rej.locator('textarea').first().fill('DEMO — file gốc độ phân giải thấp');
  await settle(page, 300);
  await shot(page, {
    role, step: 8, key: '08-reject-modal',
    shows: 'Không làm được đơn: bắt buộc chọn designer nhận thay, lý do tùy chọn. Đơn chuyển sang Cần làm của người đó.',
    clip: [rej], pad: 24,
    callouts: [
      { target: rsel, label: 'Chuyển cho designer', detail: 'Người nhận thay (kèm số đơn đang làm).' },
      { target: rej.locator('textarea').first(), label: 'Lý do', detail: 'Không bắt buộc, tối đa 500 ký tự.' },
      { target: rej.getByRole('button', { name: 'Không làm được', exact: true }), detail: 'Xác nhận bàn giao.' },
    ],
  });
  await rej.getByRole('button', { name: 'Hủy' }).click();
  await context.close();
}

// ─────────────────────────────────────────────────────────── CÔNG NHÂN FULFILLMENT (In / Ép / QC sau ép / Đóng hàng)
// Quy ước chung: đăng nhập bằng form (công nhân về Dashboard, KHÔNG về Task), vào Task Fulfillment qua URL,
// ẩn "Tổng quan theo ngày" (PipelineDailyOverview). Mọi thao tác QUÉT là phím thật `page.keyboard.type` + Enter
// (máy quét USB gõ như bàn phím) — không gọi API rồi chụp kết quả.
const WORKER_HIDE = ['Tổng quan theo ngày'];
const code = (n) => `${DEMO_PREFIX}${n}`;
const inMain = (page) => page.locator('main');

/** Gõ như máy quét USB: chuỗi ký tự nhanh (20ms/phím) + Enter. */
async function scanKeys(page, text) {
  await page.keyboard.type(text, { delay: 20 });
  await page.keyboard.press('Enter');
}

/** Cuộn NGANG vùng `.overflow-x-auto` gần nhất để phần tử cách mép trái vùng đó `left` px (bảng In rộng hơn màn hình). */
async function scrollXTo(locator, left = 360) {
  await locator.first().evaluate((el, left) => {
    const box = el.closest('.overflow-x-auto');
    if (box) box.scrollLeft += el.getBoundingClientRect().left - box.getBoundingClientRect().left - left;
  }, left);
}

/** Thẻ kanban Fulfillment (FulfillmentTaskCard, `div.group.rounded-md`) chứa nút mã sản xuất. */
const kanbanCard = (page, n) => page.locator('div.group.rounded-md', { has: page.getByRole('button', { name: code(n), exact: true }) }).first();
/** Tiêu đề cột kanban — thẻ KPI cùng chữ nằm TRƯỚC trong DOM nên lấy phần tử cuối. */
const colTitle = (page, label) => inMain(page).getByText(label, { exact: true }).last();
const kpiLabel = (page, label) => inMain(page).getByText(label, { exact: true }).first();

async function openKanban(page, waitCode) {
  await go(page, '/ffm/fulfillment/my-tasks');
  await page.getByRole('button', { name: code(waitCode), exact: true }).first().waitFor({ timeout: 60000 });
  await settle(page, 500);
  const hidden = await hideSections(page, WORKER_HIDE);
  if (!hidden.length) throw new Error('Không ẩn được khối "Tổng quan theo ngày"');
  return hidden.map((h) => `Ẩn khối "${h}" (bảng số theo ngày — gọn ảnh)`);
}

async function openScanPage(page) {
  await go(page, '/ffm/orders/scan-error');
  const input = page.getByPlaceholder(/^Quét barcode/);
  await input.waitFor({ timeout: 60000 });
  await input.focus();
  return input;
}

async function scanOrderOpenDialog(page, input, n, titleRe) {
  await input.focus();
  await scanKeys(page, `N-${code(n)}`);
  const dlg = page.getByRole('dialog').filter({ hasText: titleRe }).last();
  await dlg.waitFor({ timeout: 30000 });
  await settle(page, 700); // autoFocus nút + ảnh mockup
  return dlg;
}

async function closeDialog(page, dlg) {
  await page.keyboard.press('Escape');
  await dlg.waitFor({ state: 'hidden', timeout: 10000 });
  await page.waitForTimeout(300);
}

async function reworkDialogFromCard(page, card, n) {
  // Thẻ Đang làm không kéo được → dnd-kit gắn aria-disabled="true" lên thẻ, Playwright coi nút con là "disabled".
  // Nút thật vẫn bấm được → click chuột thật, bỏ kiểm tra actionability.
  await card.getByRole('button', { name: 'Báo lỗi', exact: true }).click({ force: true });
  const dlg = page.getByRole('dialog').filter({ hasText: `Báo lỗi đơn ${code(n)}` }).last();
  await dlg.waitFor({ timeout: 15000 });
  return dlg;
}

// ── In: bảng phẳng (PrintWorkshopView), không phải kanban
async function capturePrint() {
  const role = 'fulfillment-print';
  const { context, page } = await newRolePage(role);
  await uiLogin(page, ROLE_ACCOUNTS[role]);
  await go(page, '/ffm/fulfillment/my-tasks');
  const rowOf = (n) => page.locator('tbody tr', { hasText: code(n) }).first();
  await rowOf('13').waitFor({ timeout: 60000 });
  await settle(page, 500);
  let masked = (await hideSections(page, WORKER_HIDE)).map((h) => `Ẩn khối "${h}" (bảng số theo ngày — gọn ảnh)`);
  const chip = (label) => inMain(page).getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) }).first();
  await shot(page, {
    role, step: 1, key: '01-print-table', masked,
    scrollTo: chip('Tất cả'), scrollOffset: 12,
    shows: 'Task Fulfillment của công nhân In là BẢNG đơn (không phải kanban). Mặc định chỉ đơn vào sản xuất HÔM NAY; chỉ đơn soát tool Ok của xưởng mình mới có nút thao tác.',
    callouts: [
      { target: page.getByRole('link', { name: 'Task Fulfillment' }), label: 'Task Fulfillment', detail: 'Menu Công việc › Task Fulfillment. Đăng nhập xong hệ thống về Dashboard — bấm menu này để vào bảng In.' },
      { target: chip('Đang chờ'), label: 'Đang chờ', detail: 'Dãy chip trạng thái In kèm số đơn — bấm để lọc bảng.' },
      { target: inMain(page).getByRole('button', { name: 'Hôm nay', exact: true }).first(), label: 'Hôm nay', detail: 'Kỳ mặc định: đơn vào sản xuất hôm nay. Đơn hôm trước còn tồn → chọn "Hôm qua" / "7 ngày".' },
      { target: inMain(page).locator('thead th', { hasText: 'Thao tác In' }).first(), label: 'Thao tác In', detail: 'Cột nút Bắt đầu / Hoàn thành / Báo lỗi của từng đơn (luôn ghim bên phải).' },
    ],
  });

  // Bước 2: tick đơn 13 (Đang chờ) → thanh công cụ
  const r13 = rowOf('13');
  await scrollMainTo(page, r13, 260);
  await r13.locator('input[type=checkbox]').first().check();
  const bulkStart = page.getByRole('button', { name: /^Bắt đầu \(1\)$/ });
  await bulkStart.waitFor({ timeout: 10000 });
  await settle(page, 300);
  await shot(page, {
    role, step: 2, key: '02-start', masked,
    shows: 'Đơn Đang chờ có nút "Bắt đầu". Làm nhiều đơn một lúc: tick các dòng rồi bấm "Bắt đầu (n)" trên thanh công cụ.',
    callouts: [
      { target: r13.getByRole('button', { name: 'Bắt đầu', exact: true }), label: 'Bắt đầu', detail: 'Bắt đầu in đơn này — đơn sang Đang làm.' },
      { target: r13.locator('input[type=checkbox]').first(), label: 'Ô chọn dòng', detail: 'Tick nhiều dòng; giữ Shift để chọn liền một dải.' },
      { target: bulkStart, detail: 'Bắt đầu tất cả đơn đã tick.' },
    ],
  });
  await r13.locator('input[type=checkbox]').first().uncheck();
  await page.waitForTimeout(300);

  // Bước 3: đơn 15 (Đang làm)
  const r15 = rowOf('15');
  await scrollMainTo(page, r15, 300);
  await settle(page, 300);
  await shot(page, {
    role, step: 3, key: '03-complete', masked,
    shows: 'Đơn Đang làm có nút "Hoàn thành" và "Báo lỗi". Hoàn thành → đơn chuyển sang Ép – Đang chờ.',
    callouts: [
      { target: r15.getByText(code('15'), { exact: true }).first(), detail: 'Mã sản xuất của đơn đang in.' },
      { target: r15.getByRole('button', { name: 'Hoàn thành', exact: true }), label: 'Hoàn thành', detail: 'In xong — đơn tự sang công đoạn Ép.' },
      { target: r15.getByRole('button', { name: 'Báo lỗi', exact: true }), label: 'Báo lỗi', detail: 'File in có vấn đề — đẩy đơn về Designer.' },
    ],
  });

  // Bước 4: dialog Báo lỗi (In chỉ đẩy về Designer)
  await r15.getByRole('button', { name: 'Báo lỗi', exact: true }).click();
  const rw = page.getByRole('dialog').filter({ hasText: `Báo lỗi đơn ${code('15')}` }).last();
  await rw.waitFor({ timeout: 15000 });
  await rw.locator('textarea').fill('DEMO — file in bị vỡ nét ở thân trước');
  await settle(page, 300);
  await shot(page, {
    role, step: 4, key: '04-report-error',
    shows: 'Báo lỗi từ bảng In: chọn nơi nhận xử lý và ghi lý do. Ở công đoạn In chỉ có một nơi nhận là Designer.',
    clip: [rw], pad: 24,
    callouts: [
      { target: rw.getByRole('button', { name: 'Designer', exact: true }), label: 'Designer', detail: 'Designer nhận lại đơn ở cột "Cần làm lại".' },
      { target: rw.locator('textarea'), label: 'Lý do lỗi *', detail: 'Bắt buộc — ghi rõ lỗi để người sửa biết sửa gì.' },
      { target: rw.getByRole('button', { name: 'Đẩy về xử lý', exact: true }), detail: 'Gửi đơn về Designer. Bảng In vẫn giữ dòng, nền đỏ tới khi đơn quay lại.' },
    ],
  });
  await rw.getByRole('button', { name: 'Hủy', exact: true }).click();
  await rw.waitFor({ state: 'hidden', timeout: 10000 });

  // Bước 5: ô "Lỗi xưởng" — đường duy nhất đẩy về Support khi thiếu file ("Thiếu file để in").
  // Không chặn cả vai nếu bảng đổi cấu trúc cột: lỗi ở bước này chỉ cảnh báo.
  try {
  const errCell = await cellByHeader(r13, 'Lỗi xưởng');
  await scrollXTo(errCell, 420);
  // Dòng lên sát đỉnh để popover (danh sách dài) có chỗ mở xuống dưới.
  await scrollMainTo(page, r13, 8);
  await errCell.locator('button').first().click();
  const pop = page.getByRole('dialog').filter({ hasText: 'Thiếu file để in' }).last();
  await pop.waitFor({ timeout: 10000 });
  await settle(page, 300);
  const optMissing = pop.getByText('Thiếu file để in', { exact: true }).first();
  // Lựa chọn nằm cuối danh sách → cuộn trong popover cho hiện ra (không cuộn <main>, tránh đóng popover).
  await optMissing.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(250);
  const cellBtn = errCell.locator('button').first();
  // Popover có thể đè lên ô vừa bấm → chỉ gắn chú thích ô khi tâm ô còn nhìn thấy.
  const cellVisible = await cellBtn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (el === at || el.contains(at));
  });
  await shot(page, {
    role, step: 5, key: '05-error-cell', masked,
    shows: 'Ô "Lỗi xưởng" trên dòng đơn: bấm ô rồi chọn lỗi có sẵn. Thiếu file để in → chọn "Thiếu file để in", đơn quay về Support soát lại (không qua Designer).',
    clip: [errCell, pop], pad: 20,
    callouts: [
      ...(cellVisible ? [{ target: cellBtn, label: 'Lỗi xưởng', detail: 'Bấm ô để mở danh sách lỗi.' }] : []),
      { target: optMissing, label: 'Thiếu file để in', detail: 'Nguồn Soát tool — đơn về danh sách "Cần làm lại" của Support.' },
    ],
  });
  await page.keyboard.press('Escape');
  await pop.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  } catch (err) {
    console.warn(`  CẢNH BÁO bỏ qua 05-error-cell: ${err.message}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(300);

  // Bước 6: chip Làm lại — đơn bị công đoạn sau đẩy về
  await chip('Làm lại').click();
  const r26 = rowOf('26');
  const r25 = rowOf('25');
  await r26.waitFor({ timeout: 30000 });
  await r25.waitFor({ timeout: 30000 });
  await settle(page, 600);
  const pushedFrom = r26.getByText(/^Bị đẩy về từ/).first();
  await scrollXTo(pushedFrom, 420);
  masked = (await hideSections(page, WORKER_HIDE)).map((h) => `Ẩn khối "${h}" (bảng số theo ngày — gọn ảnh)`);
  await shot(page, {
    role, step: 6, key: '06-rework-watching', masked,
    scrollTo: chip('Tất cả'), scrollOffset: 12,
    shows: 'Chip "Làm lại": đơn công đoạn sau (Ép, QC) đẩy về In. Dòng nền đỏ = đơn đang có lỗi chưa xử lý; ô trạng thái ghi rõ bị đẩy về từ đâu và lý do. Chip "Đang chờ quay lại" là đơn In đã xong nhưng đang bị xử lý lại ở chỗ khác. LƯU Ý: đơn QC báo lỗi qua quét/gán lỗi (dòng đỏ) KHÔNG có nút trên bảng — in lại bằng trang Quét mã.',
    callouts: [
      { target: chip('Làm lại'), label: 'Làm lại', detail: 'Đơn cần in lại — làm như đơn mới: Bắt đầu → Hoàn thành.' },
      { target: pushedFrom, detail: 'Công đoạn đã đẩy về và lý do (dòng đỏ: QC báo "In lệch"). Dòng này không có nút — quét mã đơn ở trang Quét mã để làm lại.' },
      { target: r25.getByRole('button', { name: 'Bắt đầu', exact: true }), label: 'Bắt đầu', detail: 'Đơn Ép đẩy về bằng "Báo lỗi" vẫn có nút — nhận in lại.' },
      { target: chip('Đang chờ quay lại'), label: 'Đang chờ quay lại', detail: 'Chỉ để theo dõi — chưa tới lượt In.' },
    ],
  });

  // Bước 7: trang Quét mã — quét `N-<mã>` bằng phím thật
  const input = await openScanPage(page);
  const dlg = await scanOrderOpenDialog(page, input, '14', 'Công đoạn của tôi');
  await shot(page, {
    role, step: 7, key: '07-scan',
    shows: 'Trang Quét mã: quét barcode đơn `N-…` → hiện màn công đoạn của bạn (ảnh lớn, chữ to). In xong quét LẠI chính mã đơn (hoặc mã OK, hoặc Enter) là hoàn thành — tự Bắt đầu + Hoàn thành.',
    callouts: [
      { target: dlg.getByText(code('14'), { exact: true }).first(), detail: 'Đơn vừa quét.' },
      { target: dlg.getByText('✔ Hoàn thành', { exact: true }), label: '✔ Hoàn thành', detail: 'Quét lại mã đơn / mã OK / Enter = xong công đoạn In.' },
      { target: dlg.getByText('⚠ Báo lỗi — quét 2 lần', { exact: true }), label: '⚠ Báo lỗi — quét 2 lần', detail: 'Quét mã lỗi `E-…` trên bảng dán trạm, quét lại cùng mã để ghi nhận.' },
      { target: dlg.getByRole('button', { name: 'Hoàn thành (Enter)' }), detail: 'Bấm tay nếu không dùng máy quét.' },
    ],
  });
  await closeDialog(page, dlg);
  await context.close();
}

// ── Ép: kanban
async function capturePress() {
  const role = 'fulfillment-press';
  const { context, page } = await newRolePage(role);
  await uiLogin(page, ROLE_ACCOUNTS[role]);
  const masked = await openKanban(page, '17');
  const search = page.getByPlaceholder('Gõ tay hoặc quét mã (N-…) rồi Enter để mở đơn');
  await shot(page, {
    role, step: 1, key: '01-kanban', masked,
    shows: 'Task của tôi — Ép: thẻ số theo cột, ô Tìm / Quét mã, kỳ ngày và bảng kanban. Cột "Làm lại" / "Đang chờ quay lại" tự ẩn khi không có đơn.',
    callouts: [
      { target: kpiLabel(page, 'Đang chờ'), label: 'Đang chờ', detail: 'Số đơn đang chờ bạn làm.' },
      { target: search, label: 'Tìm / Quét mã', detail: 'Quét `N-…` rồi Enter → mở đơn để Hoàn thành / Báo lỗi; gõ chữ để lọc kanban.' },
      { target: inMain(page).getByRole('button', { name: '7 ngày', exact: true }).first(), label: '7 ngày', detail: 'Kỳ mặc định 7 ngày theo ngày vào sản xuất.' },
      { target: colTitle(page, 'Đang chờ'), label: 'Cột Đang chờ', detail: 'Kéo thẻ Đang chờ sang Đang làm = Bắt đầu.' },
    ],
  });

  await search.click();
  await scanKeys(page, `N-${code('16')}`);
  const dlg = page.getByRole('dialog').filter({ hasText: 'Công đoạn của tôi' }).last();
  await dlg.waitFor({ timeout: 30000 });
  await settle(page, 700);
  await shot(page, {
    role, step: 2, key: '02-scan-dialog',
    shows: 'Quét mã ngay trong ô Tìm của kanban: mở màn công đoạn của đơn. Dải xanh = đúng công đoạn của bạn → Enter / "Hoàn thành (Enter)" là xong. Ở màn này quét mã lỗi `E-…` KHÔNG ghi lỗi — báo lỗi bằng quét dùng trang Quét mã.',
    callouts: [
      { target: dlg.getByText(/đúng công đoạn của bạn/).first(), label: 'Đúng công đoạn của bạn', detail: 'Dải xanh: đơn đang ở Ép, thao tác được.' },
      { target: dlg.getByText('✔ Hoàn thành', { exact: true }), label: '✔ Hoàn thành', detail: 'Quét lại mã đơn / mã OK / Enter.' },
      { target: dlg.getByRole('button', { name: 'Báo lỗi', exact: true }), label: 'Báo lỗi', detail: 'Mở màn gán lỗi cho đơn này.' },
      { target: dlg.getByRole('button', { name: 'Hoàn thành (Enter)' }), detail: 'Tự Bắt đầu + Hoàn thành trong một lần.' },
    ],
  });
  await closeDialog(page, dlg);
  await search.fill('');
  await settle(page, 500);

  const c17 = kanbanCard(page, '17');
  const c18 = kanbanCard(page, '18');
  await shot(page, {
    role, step: 3, key: '03-card-actions', masked,
    shows: 'Nút trên thẻ: Đang chờ có "Bắt đầu"; Đang làm có "Hoàn thành" và "Báo lỗi". Thẻ ở Đã xong / Đang chờ quay lại không có nút.',
    clip: [colTitle(page, 'Đang chờ'), c17, colTitle(page, 'Đang làm'), c18], pad: 16,
    callouts: [
      { target: c17.getByRole('button', { name: 'Bắt đầu', exact: true }), label: 'Bắt đầu', detail: 'Nhận làm đơn.' },
      { target: c18.getByRole('button', { name: 'Hoàn thành', exact: true }), label: 'Hoàn thành', detail: 'Ép xong — đơn sang QC sau ép.' },
      { target: c18.getByRole('button', { name: 'Báo lỗi', exact: true }), label: 'Báo lỗi', detail: 'Đẩy đơn về In hoặc Designer.' },
    ],
  });

  const rw = await reworkDialogFromCard(page, c18, '18');
  await rw.locator('textarea').fill('DEMO — hình in bong mép sau khi ép');
  await settle(page, 300);
  await shot(page, {
    role, step: 4, key: '04-rework-dialog',
    shows: 'Báo lỗi ở Ép: chọn nơi nhận (mặc định công đoạn ngay trước — In) và ghi lý do. In nhận đơn ở "Làm lại"; Ép thấy đơn ở "Đang chờ quay lại".',
    clip: [rw], pad: 24,
    callouts: [
      { target: rw.getByRole('button', { name: 'In', exact: true }), label: 'In', detail: 'Lỗi do in — In làm lại.' },
      { target: rw.getByRole('button', { name: 'Designer', exact: true }), label: 'Designer', detail: 'Lỗi do file thiết kế.' },
      { target: rw.locator('textarea'), label: 'Lý do lỗi *', detail: 'Bắt buộc.' },
      { target: rw.getByRole('button', { name: 'Đẩy về xử lý', exact: true }), detail: 'Gửi đơn về nơi đã chọn.' },
    ],
  });
  await rw.getByRole('button', { name: 'Hủy', exact: true }).click();
  await rw.waitFor({ state: 'hidden', timeout: 10000 });

  const c25 = kanbanCard(page, '25');
  await shot(page, {
    role, step: 5, key: '05-watching', masked,
    shows: 'Cột "Đang chờ quay lại": đơn Ép đã làm (hoặc đã đẩy về) đang ở công đoạn trước. Khi đơn quay lại Ép sẽ vào "Làm lại"; làm xong vào "Đã sửa".',
    clip: [colTitle(page, 'Đang chờ quay lại'), c25], pad: 16,
    callouts: [
      { target: colTitle(page, 'Đang chờ quay lại'), label: 'Đang chờ quay lại', detail: 'Chỉ theo dõi — chưa tới lượt bạn.' },
      { target: c25.getByText('Đang ở:').first(), label: 'Đang ở: In', detail: 'Công đoạn đang giữ đơn.' },
    ],
  });

  await go(page, '/ffm/orders/stage-errors');
  const firstTick = inMain(page).locator('li input[type=checkbox]').first();
  await firstTick.waitFor({ timeout: 60000 });
  await firstTick.check();
  await settle(page, 400);
  await shot(page, {
    role, step: 6, key: '06-stage-errors',
    shows: 'Danh mục lỗi công đoạn: công nhân tự thêm lỗi cho trạm mình (khoá sẵn công đoạn Ép) kèm nơi đẩy về, rồi tick lỗi để in bảng barcode dán tại trạm. Lỗi đã thêm không sửa được, chỉ ẩn/hiện.',
    callouts: [
      { target: inMain(page).getByText('Ép', { exact: true }).first(), label: 'Công đoạn: Ép', detail: 'Tài khoản công nhân bị khoá vào công đoạn của mình.' },
      { target: page.getByPlaceholder(/^Tên lỗi/), label: 'Tên lỗi', detail: 'Gõ tên lỗi, chọn "Đẩy về công đoạn" bên dưới.' },
      { target: inMain(page).getByRole('button', { name: 'Thêm & tạo Barcode', exact: true }), detail: 'Lưu lỗi — barcode `E-…` sinh tự động.' },
      { target: inMain(page).getByRole('button', { name: /^In \(1\)$/ }), label: 'In (1)', detail: 'In bảng barcode các lỗi đã tick (kèm nhãn HOÀN THÀNH).' },
    ],
    masked: [],
  });
  await context.close();
}

// ── QC sau ép: kanban + quét lỗi 2 lần
async function captureQc() {
  const role = 'fulfillment-qc-post-press';
  const stage = 'qc-post-press';
  const { context, page } = await newRolePage(role);
  await uiLogin(page, ROLE_ACCOUNTS[role]);
  const masked = await openKanban(page, '19');
  await shot(page, {
    role, step: 1, key: '01-kanban', masked,
    shows: 'Task của tôi — QC sau ép. Xưởng DTF bỏ may: QC xong thì May vào + May ra TỰ hoàn thành, đơn sang thẳng Đóng hàng.',
    callouts: [
      { target: kpiLabel(page, 'Đang chờ'), label: 'Đang chờ', detail: 'Số đơn Ép đã xong đang chờ QC.' },
      { target: colTitle(page, 'Đang chờ'), label: 'Cột Đang chờ', detail: 'Đơn chờ kiểm.' },
      { target: colTitle(page, 'Đang làm'), label: 'Cột Đang làm', detail: 'Đơn đang kiểm.' },
      { target: colTitle(page, 'Đang chờ quay lại'), label: 'Cột Đang chờ quay lại', detail: 'Đơn bạn đã báo lỗi, đang được In/Ép làm lại.' },
    ],
  });

  let input = await openScanPage(page);
  let dlg = await scanOrderOpenDialog(page, input, '19', 'Công đoạn của tôi');
  await shot(page, {
    role, step: 2, key: '02-scan-ok',
    shows: 'Quét `N-…` đơn đang chờ QC → màn công đoạn. Kiểm đạt: quét lại mã đơn hoặc mã OK (hoặc Enter) → QC xong, đơn sang Đóng hàng – Đang chờ.',
    callouts: [
      { target: dlg.getByRole('heading', { name: /Công đoạn của tôi · QC sau ép/ }), label: 'Công đoạn của tôi · QC sau ép', detail: 'Màn của đúng công đoạn tài khoản đang đăng nhập.' },
      { target: dlg.getByText('Công đoạn hiện tại:').first(), label: 'Công đoạn hiện tại', detail: 'Đơn đang ở QC sau ép.' },
      { target: dlg.getByText('✔ Hoàn thành', { exact: true }), label: '✔ Hoàn thành', detail: 'Quét lại mã đơn / OK / Enter.' },
      { target: dlg.getByRole('button', { name: 'Hoàn thành (Enter)' }), detail: 'Bấm tay nếu không dùng máy quét.' },
    ],
  });
  await closeDialog(page, dlg);

  // Quét lỗi 2 lần: N-21 → E-<mã> (lần 1 = CHỌN). Không quét lần 2 để giữ dữ liệu demo.
  const errName = 'Hình in nứt khi kéo giãn';
  input = page.getByPlaceholder(/^Quét barcode/);
  dlg = await scanOrderOpenDialog(page, input, '21', 'Công đoạn của tôi');
  await scanKeys(page, `E-${demoErrorCode(stage, errName)}`);
  const edlg = page.getByRole('dialog').filter({ hasText: `Gán lỗi · ${code('21')}` }).last();
  await edlg.waitFor({ timeout: 15000 });
  await edlg.getByText('Đẩy về Ép', { exact: true }).first().waitFor({ timeout: 10000 });
  await settle(page, 600);
  await shot(page, {
    role, step: 3, key: '03-scan-error-2x',
    shows: 'Báo lỗi bằng máy quét: đang mở đơn, quét mã lỗi `E-…` trên bảng dán trạm → lỗi được CHỌN (chưa ghi nhận), nơi đẩy về tự theo danh mục. Quét lại CÙNG mã (hoặc Enter) mới ghi nhận và đẩy đơn về. Quét nhầm → quét mã khác để đổi.',
    callouts: [
      { target: edlg.getByRole('button', { name: errName, exact: true }), label: errName, detail: 'Lỗi vừa quét lần 1 (tô đỏ).' },
      { target: edlg.getByText('Đẩy về Ép', { exact: true }).first(), label: 'Do xưởng · Đẩy về Ép', detail: 'Nguồn lỗi + nơi nhận lấy từ danh mục, không chỉnh tay.' },
      { target: edlg.getByText('Quét lại CÙNG MÃ / Enter', { exact: true }), label: 'Quét lại CÙNG MÃ / Enter', detail: 'Bước xác nhận — lúc này lỗi mới được ghi.' },
      { target: edlg.getByRole('button', { name: 'Gán lỗi & Quét tiếp' }), detail: 'Bấm tay thay cho quét lần 2.' },
    ],
  });
  await closeDialog(page, edlg);

  await openKanban(page, '21');
  const c21 = kanbanCard(page, '21');
  const rw = await reworkDialogFromCard(page, c21, '21');
  await rw.locator('textarea').fill('DEMO — hình in nứt khi kéo giãn');
  await settle(page, 300);
  await shot(page, {
    role, step: 4, key: '04-rework-dialog',
    shows: 'Báo lỗi từ thẻ kanban (không cần máy quét): chọn Designer / In / Ép, ghi lý do.',
    clip: [rw], pad: 24,
    callouts: [
      { target: rw.getByRole('button', { name: 'Ép', exact: true }), label: 'Ép', detail: 'Mặc định: công đoạn ngay trước.' },
      { target: rw.getByRole('button', { name: 'In', exact: true }), label: 'In', detail: 'Lỗi in — In làm lại, Ép cũng làm lại theo.' },
      { target: rw.getByRole('button', { name: 'Designer', exact: true }), label: 'Designer', detail: 'Lỗi file thiết kế.' },
      { target: rw.locator('textarea'), label: 'Lý do lỗi *', detail: 'Bắt buộc.' },
    ],
  });
  await rw.getByRole('button', { name: 'Hủy', exact: true }).click();
  await rw.waitFor({ state: 'hidden', timeout: 10000 });

  await go(page, '/ffm/orders/stage-errors');
  const headTick = inMain(page).locator('label', { hasText: 'Lỗi của' }).locator('input[type=checkbox]');
  await inMain(page).locator('li input[type=checkbox]').first().waitFor({ timeout: 60000 });
  await headTick.check();
  const exportBtn = inMain(page).getByRole('button', { name: /^Xuất PDF \(\d+\)$/ });
  await settle(page, 400);
  await shot(page, {
    role, step: 5, key: '05-barcode-sheet',
    shows: 'In bảng barcode dán trạm QC: tick cả danh sách rồi "In" hoặc "Xuất PDF" (mỗi nhãn một trang A8, trang đầu là nhãn HOÀN THÀNH = mã OK).',
    callouts: [
      { target: headTick, label: 'Chọn tất cả', detail: 'Tick để chọn mọi lỗi của công đoạn.' },
      { target: inMain(page).locator('li code').first(), label: 'Mã quét E-…', detail: 'Nội dung barcode — máy quét gõ đúng chuỗi này.' },
      { target: inMain(page).getByRole('button', { name: /^In \(\d+\)$/ }), label: 'In (n)', detail: 'In thẳng ra máy in.' },
      { target: exportBtn, label: 'Xuất PDF (n)', detail: 'Tải PDF nhãn A8 để in sau.' },
    ],
  });
  await context.close();
}

// ── Đóng hàng: kanban + hoàn thành hàng loạt + quét hoàn thành
async function capturePack() {
  const role = 'fulfillment-pack';
  const { context, page } = await newRolePage(role);
  await uiLogin(page, ROLE_ACCOUNTS[role]);
  const masked = await openKanban(page, '22');
  await shot(page, {
    role, step: 1, key: '01-kanban', masked,
    shows: 'Task của tôi — Đóng hàng: công đoạn cuối. Xưởng DTF chưa bật "Tự hoàn thành Đóng hàng" nên phải xác nhận tay từng đơn.',
    callouts: [
      { target: kpiLabel(page, 'Đang chờ'), label: 'Đang chờ', detail: 'Đơn QC xong đang chờ đóng.' },
      { target: colTitle(page, 'Đang chờ'), label: 'Cột Đang chờ', detail: 'Đơn cần đóng gói.' },
      { target: colTitle(page, 'Đang làm'), label: 'Cột Đang làm', detail: 'Đơn đang đóng.' },
      { target: colTitle(page, 'Đã xong'), label: 'Cột Đã xong', detail: 'Đơn đã hoàn thành sản xuất.' },
    ],
  });

  const colAll = inMain(page).locator('[title="Chọn / bỏ chọn cả cột"]').first();
  await colAll.click();
  const bar = page.locator('div.sticky.bottom-3').first();
  await bar.getByRole('button', { name: 'Hoàn thành', exact: true }).waitFor({ timeout: 10000 });
  await settle(page, 400);
  await shot(page, {
    role, step: 2, key: '02-bulk-complete', masked,
    scrollTo: colTitle(page, 'Đang chờ'), scrollOffset: 120,
    shows: 'Riêng Đóng hàng: tick cả cột Đang chờ rồi bấm "Hoàn thành" — hệ thống tự Bắt đầu + Hoàn thành từng đơn, không cần qua Đang làm.',
    callouts: [
      { target: colAll, label: 'Chọn cả cột', detail: 'Tick mọi đơn trong cột Đang chờ.' },
      { target: bar.getByText(/^Đã chọn/).first(), label: 'Đã chọn n', detail: 'Số đơn đang chọn.' },
      { target: bar.getByRole('button', { name: 'Hoàn thành', exact: true }), label: 'Hoàn thành', detail: 'Đóng xong tất cả đơn đã chọn.' },
    ],
  });
  await bar.locator('button').last().click();
  await page.waitForTimeout(400);

  const c30 = kanbanCard(page, '30');
  const rw = await reworkDialogFromCard(page, c30, '30');
  await rw.getByRole('button', { name: 'QC sau ép', exact: true }).click();
  await rw.locator('textarea').fill('DEMO — áo bẩn khi gấp đóng gói');
  await settle(page, 300);
  await shot(page, {
    role, step: 3, key: '03-report-error',
    shows: 'Báo lỗi ở Đóng hàng (đơn Đang làm): chọn công đoạn nhận lại + lý do. Dialog vẫn hiện "May nhận vào" / "May xuất ra" dù xưởng DTF bỏ may — chọn các chip này hệ thống tự lùi về QC sau ép.',
    clip: [rw], pad: 24,
    callouts: [
      { target: rw.getByRole('button', { name: 'QC sau ép', exact: true }), label: 'QC sau ép', detail: 'Nơi nhận hợp lý nhất với xưởng DTF.' },
      { target: rw.getByRole('button', { name: 'May xuất ra', exact: true }), label: 'May xuất ra', detail: 'Mặc định của dialog — xưởng bỏ may sẽ tự lùi về QC sau ép.' },
      { target: rw.locator('textarea'), label: 'Lý do lỗi *', detail: 'Bắt buộc.' },
      { target: rw.getByRole('button', { name: 'Đẩy về xử lý', exact: true }), detail: 'Gửi đơn về công đoạn đã chọn.' },
    ],
  });
  await rw.getByRole('button', { name: 'Hủy', exact: true }).click();
  await rw.waitFor({ state: 'hidden', timeout: 10000 });

  const input = await openScanPage(page);
  const dlg = await scanOrderOpenDialog(page, input, '22', 'Công đoạn của tôi');
  await shot(page, {
    role, step: 4, key: '04-scan-complete',
    shows: 'Quét `N-…` đơn đang chờ Đóng hàng → màn công đoạn. Đóng gói xong quét lại mã đơn / OK / Enter → đơn hoàn thành sản xuất, khách nhận thông báo.',
    callouts: [
      { target: dlg.getByText('Đang chờ', { exact: true }).first(), label: 'Đang chờ', detail: 'Trạng thái Đóng hàng của đơn.' },
      { target: dlg.getByText('✔ Hoàn thành', { exact: true }), label: '✔ Hoàn thành', detail: 'Quét lại mã đơn / OK / Enter.' },
      { target: dlg.getByText(/^Làm XONG → quét LẠI mã đơn/).first(), label: 'Làm XONG → quét LẠI mã đơn (hoặc mã "OK")', detail: 'Không cần chạm máy tính.' },
      { target: dlg.getByRole('button', { name: 'Hoàn thành (Enter)' }), detail: 'Tự Bắt đầu + Hoàn thành.' },
    ],
  });
  await closeDialog(page, dlg);

  // Bước 5: quét THẬT N-29 rồi OK → đơn 29 hoàn thành (TIÊU HAO). Đã hoàn thành từ lần trước → bỏ qua, giữ ảnh cũ.
  const o29 = (await api(supportToken, 'GET', `/orders/by-production-id/${code('29')}`)).data;
  if (o29?.currentFulfillmentStage !== 'pack' || o29?.fulfillmentStages?.pack?.status !== 'waiting') {
    console.warn(`  BỎ QUA 05-scan-done: ${code('29')} không còn ở Đóng hàng – Đang chờ (đã tiêu hao) — giữ ảnh/mục manifest cũ nếu có.`);
  } else {
    const d29 = await scanOrderOpenDialog(page, input, '29', 'Công đoạn của tôi');
    await scanKeys(page, 'OK');
    await d29.waitFor({ state: 'hidden', timeout: 30000 });
    const hist = inMain(page).locator('li', { hasText: code('29') }).first();
    await hist.getByText('Đã hoàn thành', { exact: true }).waitFor({ timeout: 15000 });
    await settle(page, 500);
    await shot(page, {
      role, step: 5, key: '05-scan-done',
      shows: 'Sau khi quét `N-…` rồi quét mã OK: màn công đoạn tự đóng, ô quét sẵn sàng cho đơn kế tiếp, lịch sử ghi "Đã hoàn thành · Hoàn thành Đóng hàng".',
      callouts: [
        { target: page.getByPlaceholder(/^Quét barcode/), label: 'Ô quét', detail: 'Tự focus lại — quét đơn tiếp theo ngay.' },
        { target: hist, label: `${code('29')} · Đã hoàn thành`, detail: 'Đơn vừa hoàn thành sản xuất.' },
        { target: inMain(page).getByText('Thành công', { exact: true }).first(), label: 'Thành công', detail: 'Đếm số lượt quét thành công trong phiên.' },
      ],
    });
  }
  await context.close();
}

// ─────────────────────────────────────────────────────────── VAI: QUẢN LÝ XƯỞNG (ADMIN)
async function captureAdmin() {
  const role = 'admin';
  const { context, page } = await newRolePage(role);
  await uiLogin(page, ROLE_ACCOUNTS[role]);
  const fid = encodeURIComponent(demoFactoryId);

  // 1–2: Dashboard › Vòng đời đơn, phạm vi xưởng demo
  await go(page, `/ffm/dashboard?tab=lifecycle&factoryId=${fid}`);
  await inMain(page).getByText('Phễu công đoạn', { exact: true }).waitFor({ timeout: 60000 });
  await settle(page, 800);
  // Locator CSS (không getByRole): menu Radix mở ra gắn aria-hidden lên header → getByRole không còn thấy nút.
  const trigger = page.locator('header button', { hasText: 'Xưởng:' }).first();
  await trigger.click();
  const menu = page.getByRole('menu').last();
  await menu.waitFor({ timeout: 10000 });
  await settle(page, 300);
  await shot(page, {
    role, step: 1, key: '01-factory-scope',
    shows: 'Bộ chọn "Xưởng" trên header (mọi trang /ffm): chọn xưởng DTF để Dashboard, Danh sách đơn… chỉ tính đơn của xưởng đó. Phạm vi nằm trên URL (?factoryId=) nên đổi trang không mất.',
    clip: [trigger, menu], pad: 24,
    callouts: [
      { target: trigger, label: 'Xưởng: …', detail: 'Bấm để đổi xưởng đang xem.' },
      { target: menu.getByRole('menuitem', { name: /DEMO-DTF/ }), label: 'DEMO-DTF · DEMO Xưởng DTF', detail: 'Xưởng đang chọn có dấu tích.' },
      { target: menu.getByRole('menuitem', { name: /Tất cả xưởng/ }), label: 'Tất cả xưởng', detail: 'Bỏ lọc — xem toàn nhà máy.' },
    ],
  });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden', timeout: 10000 });
  await shot(page, {
    role, step: 2, key: '02-lifecycle',
    shows: 'Dashboard › Vòng đời đơn của xưởng DTF: dải phễu trên cùng (tra nhanh 1 mã đơn), thẻ "Công đoạn tắc nghẽn" và phễu từng công đoạn — thấy đơn đang dồn ở đâu.',
    callouts: [
      { target: page.getByPlaceholder(/^Tra cứu productionId/), label: 'Tra cứu productionId', detail: 'Dán mã sản xuất để xem hành trình 1 đơn.' },
      { target: page.getByRole('link', { name: 'Vòng đời đơn' }), label: 'Vòng đời đơn', detail: 'Menu Dashboard › Vòng đời đơn.' },
      { target: inMain(page).getByText('Công đoạn tắc nghẽn', { exact: true }), label: 'Công đoạn tắc nghẽn', detail: 'Công đoạn đang có nhiều đơn chờ nhất.' },
      { target: inMain(page).getByText('Phễu công đoạn', { exact: true }), label: 'Phễu công đoạn', detail: 'Mỗi ô: đang chờ / đang làm / rework / lỗi của 1 công đoạn.' },
    ],
  });

  // 3–4: Danh sách đơn theo xưởng, giữ / mở giữ
  await go(page, `/ffm/orders/workshop?factoryId=${fid}`);
  const heldPill = inMain(page).getByRole('button', { name: /^Đang giữ\s*\d+$/ }).first();
  await heldPill.waitFor({ timeout: 60000 });
  await settle(page, 600);
  await shot(page, {
    role, step: 3, key: '03-workshop-list',
    shows: 'Danh sách đơn của xưởng DTF: dải chặng Soát tool → … → Đóng hàng (số đơn đang ở mỗi chặng), các pill lọc nhanh và cột loại sản phẩm bên trái. Ngày mặc định: hôm nay.',
    callouts: [
      { target: inMain(page).getByText('Soát tool', { exact: true }).first(), label: 'Dải chặng', detail: 'Bấm 1 chặng để lọc đơn đang ở chặng đó.' },
      { target: heldPill, label: 'Đang giữ', detail: 'Lọc đơn đang bị giữ.' },
      { target: inMain(page).getByText(DEMO_PRODUCT, { exact: true }).first(), label: 'Loại sản phẩm', detail: 'Cột trái: lọc theo sản phẩm.' },
      { target: inMain(page).getByRole('button', { name: /Hôm nay/ }).first(), label: 'Hôm nay', detail: 'Đổi ngày vào sản xuất cần xem.' },
    ],
  });

  await heldPill.click();
  const groupCell = page.locator('td', { has: page.getByText(DEMO_PRODUCT, { exact: true }) }).first();
  await groupCell.waitFor({ timeout: 30000 });
  await settle(page, 500);
  const r27 = page.locator('tr', { hasText: code('27') }).first();
  if (!(await r27.count())) await groupCell.click();
  await r27.waitFor({ timeout: 30000 });
  await scrollMainTo(page, r27, 200);
  await r27.hover();
  await r27.getByRole('button', { name: 'Thao tác đơn' }).click();
  const unhold = page.getByRole('menuitem', { name: 'Mở giữ' });
  await unhold.waitFor({ timeout: 10000 });
  await settle(page, 300);
  const rowMenu = page.getByRole('menu').last();
  await shot(page, {
    role, step: 4, key: '04-hold-unhold',
    shows: 'Đơn đang giữ khoá mọi thao tác công đoạn (công nhân không thấy nút). Xử lý xong lý do giữ → menu "…" của dòng › "Mở giữ".',
    clip: [r27, rowMenu], pad: 16,
    callouts: [
      { target: r27.getByText(code('27'), { exact: true }).first(), detail: 'Đơn đang giữ (lọc bằng pill "Đang giữ").' },
      { target: unhold, label: 'Mở giữ', detail: 'Mở khoá — đơn quay lại luồng sản xuất.' },
    ],
  });
  await page.keyboard.press('Escape');

  // 5: Nhật ký bù lỗi (không lọc theo xưởng → che)
  await go(page, '/ffm/orders/error-log');
  const r26 = page.locator('tr', { hasText: code('26') }).first();
  await r26.waitFor({ timeout: 60000 });
  await settle(page, 600);
  await shot(page, {
    role, step: 5, key: '05-error-log',
    shows: 'Nhật ký bù lỗi: mọi đơn đang có lỗi sau khi vào in. Mức độ tính theo số giờ từ lúc vào sản xuất (Mới < 2h · Cần làm 2–4h · Gấp 4–6h · Khẩn cấp > 6h). Bảng rộng — cuộn ngang để thấy "Chặng hiện tại", "Nêu lỗi", "Người sửa". Trang này KHÔNG lọc theo bộ chọn xưởng.',
    callouts: [
      { target: inMain(page).getByRole('button', { name: 'Cần xử lý', exact: true }), label: 'Cần xử lý', detail: 'Đơn lỗi chưa xử lý xong.' },
      { target: inMain(page).locator('thead th', { hasText: 'Mức độ' }).first(), label: 'Mức độ', detail: 'Đỏ đậm = để lâu nhất, xử lý trước.' },
      { target: inMain(page).locator('thead th', { hasText: 'Lỗi xưởng' }).first(), label: 'Lỗi xưởng', detail: 'Lỗi đã báo; cuộn ngang tiếp để xem "Chặng hiện tại" (đơn đang ở công đoạn nào).' },
      { target: r26.getByText(code('26'), { exact: true }).first(), detail: 'Đơn QC báo "In lệch", đang ở In làm lại.' },
    ],
  });

  // 6: Quét mã bằng tài khoản không có công đoạn → chỉ gán lỗi
  const input = await openScanPage(page).catch(async () => {
    // Admin không có công đoạn → tiêu đề "Quét mã", placeholder vẫn là "Quét barcode…"
    throw new Error('Không mở được trang Quét mã');
  });
  await input.focus();
  await scanKeys(page, `N-${code('20')}`);
  const edlg = page.getByRole('dialog').filter({ hasText: `Gán lỗi · ${code('20')}` }).last();
  await edlg.waitFor({ timeout: 30000 });
  await settle(page, 700);
  const errName = 'Áo ố vàng do nhiệt ép';
  await scanKeys(page, `E-${demoErrorCode('qc-post-press', errName)}`);
  await edlg.getByText('Đẩy về Ép', { exact: true }).first().waitFor({ timeout: 10000 });
  await settle(page, 400);
  await shot(page, {
    role, step: 6, key: '06-scan-assign-error',
    shows: 'Admin / quản lý (không có công đoạn) quét `N-…` → mở thẳng màn GÁN LỖI theo công đoạn hiện tại của đơn; không có nút Hoàn thành. Quét `E-…` lần 1 để chọn, lần 2 để ghi nhận.',
    callouts: [
      { target: edlg.getByRole('heading', { name: `Gán lỗi · ${code('20')}` }), label: `Gán lỗi · ${code('20')}`, detail: 'Chỉ gán lỗi — hoàn thành công đoạn là việc của công nhân.' },
      { target: edlg.getByRole('button', { name: errName, exact: true }), label: errName, detail: 'Danh sách lỗi của công đoạn đơn đang đứng (QC sau ép).' },
      { target: edlg.getByText('Đẩy về Ép', { exact: true }).first(), label: 'Do xưởng · Đẩy về Ép', detail: 'Tự theo danh mục.' },
      { target: edlg.getByRole('button', { name: 'Gán lỗi & Quét tiếp' }), detail: 'Ghi nhận (hoặc quét lại cùng mã).' },
    ],
  });
  await closeDialog(page, edlg);

  // 7: Danh mục lỗi công đoạn — Admin chọn được mọi công đoạn
  await go(page, '/ffm/orders/stage-errors');
  const qcChip = inMain(page).getByRole('button', { name: 'QC sau ép', exact: true });
  await qcChip.waitFor({ timeout: 60000 });
  await qcChip.click();
  await inMain(page).getByText('Hình in nứt khi kéo giãn', { exact: true }).waitFor({ timeout: 30000 });
  await settle(page, 400);
  await shot(page, {
    role, step: 7, key: '07-stage-error-catalog',
    shows: 'Danh mục lỗi công đoạn (Admin): chọn công đoạn bất kỳ để thêm lỗi, xem mã barcode và in bảng dán trạm. Danh mục DÙNG CHUNG mọi xưởng — lỗi thêm cho DTF cũng hiện ở xưởng khác.',
    callouts: [
      { target: qcChip, label: 'Công đoạn', detail: 'Admin chọn được cả 6 công đoạn (công nhân bị khoá vào công đoạn của mình).' },
      { target: page.getByPlaceholder(/^Tên lỗi/), label: 'Tên lỗi', detail: 'Thêm lỗi mới + chọn nơi đẩy về.' },
      { target: inMain(page).locator('li', { hasText: 'Hình in nứt khi kéo giãn' }).locator('code').first(), label: 'Mã E-…', detail: 'Nội dung barcode lỗi.' },
      { target: inMain(page).getByRole('button', { name: /^Xuất PDF \(\d+\)$/ }), label: 'Xuất PDF', detail: 'Tick lỗi rồi in / xuất PDF bảng barcode.' },
    ],
  });

  // 8: Sản phẩm › Xưởng › Sửa xưởng DEMO — luồng bỏ may + tự hoàn thành Đóng hàng
  await go(page, '/adm/products');
  await page.getByRole('tab', { name: 'Xưởng', exact: true }).click();
  const facRow = page.locator('tr', { hasText: 'DEMO Xưởng DTF' }).first();
  await facRow.waitFor({ timeout: 60000 });
  await facRow.getByRole('button', { name: 'Sửa', exact: true }).click();
  const fdlg = page.getByRole('dialog').filter({ hasText: 'Luồng sản xuất' }).last();
  await fdlg.waitFor({ timeout: 15000 });
  await settle(page, 400);
  const packBox = fdlg.locator('div.rounded-md', { hasText: 'Tự hoàn thành Đóng hàng' }).last();
  await shot(page, {
    role, step: 8, key: '08-factory-flow',
    shows: 'Sản phẩm › tab Xưởng › Sửa xưởng: "Luồng sản xuất = Bỏ may" (QC xong May tự xong) và công tắc "Tự hoàn thành Đóng hàng". Công tắc chỉ áp đơn MỚI; đơn đang tồn dùng nút "Hoàn thành đơn tồn ở Đóng hàng" (chỉ Admin/SuperAdmin).',
    clip: [fdlg], pad: 24,
    callouts: [
      { target: fdlg.locator('select').first(), label: 'Luồng sản xuất', detail: 'Xưởng DTF: "Bỏ may — QC xong nhảy thẳng Đóng hàng".' },
      { target: packBox.getByRole('switch'), label: 'Tự hoàn thành Đóng hàng', detail: 'Tắt (như xưởng DTF thật) → cần công nhân Đóng hàng xác nhận. Bật → đơn tới Đóng hàng tự xong.' },
      { target: fdlg.getByRole('button', { name: 'Hoàn thành đơn tồn ở Đóng hàng' }), detail: 'Dọn một lần mọi đơn đang chờ Đóng hàng của xưởng.' },
    ],
  });
  await fdlg.getByRole('button', { name: 'Hủy', exact: true }).click();

  // 9–10: Người dùng — gán người cho từng công đoạn
  await go(page, '/adm/users');
  const qcRow = page.locator('tr', { hasText: 'demo.qc@example.com' }).first();
  await qcRow.waitFor({ timeout: 60000 });
  await settle(page, 400);
  const addBtn = inMain(page).getByRole('button', { name: 'Thêm user' });
  await shot(page, {
    role, step: 9, key: '09-users-list',
    shows: 'Quản trị › Nhân sự & phân quyền › Người dùng: mỗi công nhân là role Fulfillment + nhãn xưởng. Mỗi (xưởng, công đoạn) chỉ 1 người.',
    callouts: [
      { target: qcRow.getByText('Fulfillment', { exact: true }), label: 'Fulfillment', detail: 'Role của công nhân công đoạn.' },
      { target: qcRow.getByText(DEMO_FACTORY, { exact: true }), label: 'Nhãn xưởng', detail: 'Xưởng công nhân được xem đơn.' },
      { target: addBtn, label: 'Thêm user', detail: 'Tạo tài khoản cho người giữ công đoạn còn trống.' },
    ],
  });
  await addBtn.click();
  const udlg = page.getByRole('dialog').filter({ hasText: 'Thêm user' }).last();
  await udlg.waitFor({ timeout: 15000 });
  await udlg.locator('select').first().selectOption({ label: 'Fulfillment' });
  const facSel = udlg.locator('select').nth(1);
  await facSel.waitFor({ timeout: 10000 });
  const facOpt = await facSel.locator('option', { hasText: DEMO_FACTORY }).first().getAttribute('value');
  await facSel.selectOption(facOpt);
  const stageSel = udlg.locator('select').nth(2);
  await stageSel.selectOption({ label: 'QC sau ép' });
  await settle(page, 300);
  await shot(page, {
    role, step: 10, key: '10-users-worker',
    shows: 'Thêm công nhân: chọn Role = Fulfillment → hiện thêm ô Xưởng và Stage Fulfillment (bắt buộc). Đơn tới công đoạn đó tự vào "Task của tôi" của người này. Ảnh không bấm Lưu.',
    clip: [udlg], pad: 24,
    callouts: [
      { target: udlg.locator('select').first(), label: 'Role', detail: 'Chọn Fulfillment.' },
      { target: facSel, label: 'Xưởng *', detail: 'Xưởng người này làm.' },
      { target: stageSel, label: 'Stage Fulfillment *', detail: 'Công đoạn người này giữ — trùng người đã có sẽ bị từ chối.' },
    ],
  });
  await udlg.getByRole('button', { name: 'Hủy', exact: true }).click();
  await context.close();
}

// ─────────────────────────────────────────────────────────── MAIN
const RUNNERS = {
  support: captureSupport,
  'designer-leader': captureLeader,
  designer: captureDesigner,
  'fulfillment-print': capturePrint,
  'fulfillment-press': capturePress,
  'fulfillment-qc-post-press': captureQc,
  'fulfillment-pack': capturePack,
  admin: captureAdmin,
};
// API/Web dev có thể tự restart giữa chừng (nodemon, agent khác sửa .tsx) → thử lại cả vai tối đa 3 lần.
for (const role of ROLES) {
  console.log(`\n## ${ROLE_TITLES[role]}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const mark = manifest.length;
    try {
      await RUNNERS[role]();
      break;
    } catch (err) {
      manifest.splice(mark);
      console.error(`LỖI [${role}] lần ${attempt}: ${err?.stack || err}`);
      if (attempt === 3) process.exitCode = 1;
      else await new Promise((r) => setTimeout(r, 8000));
    } finally {
      for (const c of openContexts) await c.close().catch(() => {});
      openContexts.clear();
    }
  }
}

// Manifest + hình học: GỘP với lần chụp trước. Vai không chụp giữ nguyên; vai vừa chụp thay theo TỪNG ẢNH
// (ảnh bỏ qua lượt này — vd 05-scan-done đã tiêu hao đơn — giữ mục cũ nếu file ảnh còn).
if (manifest.length) {
  const mfPath = path.join(OUT, 'manifest.json');
  const prev = fs.existsSync(mfPath) ? JSON.parse(fs.readFileSync(mfPath, 'utf8')) : [];
  const done = new Set(manifest.map((m) => m.role));
  const keep = prev.filter((r) => !done.has(r.role));
  const roles = [
    ...keep,
    ...[...done].map((role) => {
      const fresh = manifest.filter((m) => m.role === role).map(({ ink: _ink, ...m }) => m);
      const freshFiles = new Set(fresh.map((m) => m.file));
      const old = (prev.find((r) => r.role === role)?.steps || []).filter((s) => !freshFiles.has(s.file) && fs.existsSync(path.join(OUT, s.file)));
      return { role, title: ROLE_TITLES[role], steps: [...fresh, ...old].sort((a, b) => a.step - b.step) };
    }),
  ];
  const order = Object.keys(ROLE_TITLES);
  roles.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  fs.writeFileSync(mfPath, JSON.stringify(roles, null, 2) + '\n');

  fs.mkdirSync(path.dirname(SHOTS_OUT), { recursive: true });
  const prevShots = fs.existsSync(SHOTS_OUT) ? JSON.parse(fs.readFileSync(SHOTS_OUT, 'utf8')) : {};
  for (const m of manifest) {
    prevShots[m.file.replace(/\.\w+$/, '')] = { file: m.file, width: m.width, height: m.height, callouts: m.callouts.map(({ n, xPct, yPct, boxPct }) => ({ n, xPct, yPct, boxPct })), ink: m.ink };
  }
  fs.writeFileSync(SHOTS_OUT, JSON.stringify(prevShots, null, 2) + '\n');
  console.log(`\nmanifest: ${mfPath} · hình học: ${SHOTS_OUT} · ${manifest.length} ảnh`);
}

await browser.close();
assetServer.close();
