/**
 * Tạo DỮ LIỆU DEMO cho trang hướng dẫn quy trình DTF theo vai (TASK-02).
 *
 * Vì sao có file này: trang hướng dẫn nội bộ `/ffm/guide/dtf` dùng ảnh CHỤP THẬT giao
 * diện apps/web, nhưng DB local là BẢN SAO PRODUCTION → không được chụp trên dữ liệu
 * thật. Script dựng một "xưởng DTF giả" đủ vai + đủ trạng thái đơn để mỗi ảnh có dữ liệu.
 *
 * NGUYÊN TẮC
 *  - CHỈ chạy vào API localhost (chặn cứng host khác).
 *  - Mọi thứ đi qua API có sẵn (import đơn + thao tác thật) để hook nghiệp vụ chạy đủ
 *    (order log, entry fulfillment, auto-advance luồng no-sew, rework-back...). KHÔNG ghi Mongo.
 *  - Idempotent: xưởng/sản phẩm/tài khoản tìm theo tên/email trước khi tạo; đơn đã tồn tại
 *    (theo productionId `DEMO-DTF-…`) thì KHÔNG chạy lại kịch bản trạng thái của nó.
 *  - Mọi thứ mang chữ DEMO; email `@example.com`; người nhận giả.
 *
 * Chạy (cần API :3007 đang chạy, DB local):
 *   node apps/web/scripts/dtf-guide/seed-demo.mjs
 *   node apps/web/scripts/dtf-guide/seed-demo.mjs --stages print,press,qc-post-press,pack
 *   node apps/web/scripts/dtf-guide/seed-demo.mjs --no-touch-dates   # không dời inProductionAt về hôm nay
 *
 * Env (đọc từ `scripts/dtf-guide/.env.local` — gitignore; biến đã đặt sẵn thắng file; KHÔNG in giá trị):
 *   DTF_API_BASE        mặc định http://127.0.0.1:3007/api/v1
 *   DTF_ADMIN_EMAIL     tài khoản SuperAdmin/Admin LOCAL để dựng xưởng/sản phẩm/user (bắt buộc)
 *   DTF_ADMIN_PASSWORD  (bắt buộc)
 *   DTF_DEMO_PASSWORD   mật khẩu cho MỌI tài khoản demo (bắt buộc, chỉ local)
 *   DTF_FLOW_TYPE       flowType xưởng demo, mặc định no-sew (= MLDTF trên DB local 11/09/2026)
 *   DTF_AUTO_PACK       1/0 autoCompletePack xưởng demo, mặc định 0 (= MLDTF)
 *
 * `--stages`: công đoạn có TÀI KHOẢN công nhân demo. USER chốt chạy đủ `print,press,qc-post-press,pack`
 * (hướng dẫn đủ 4 công đoạn dù MLDTF thật chưa có người giữ QC sau ép + Đóng hàng). Công đoạn không có
 * người vẫn có ĐƠN demo — thao tác do Admin demo làm thay qua API (Admin thuộc OVERRIDE_ROLES của fulfillment).
 *
 * Còn tạo: tài khoản Admin demo (`demo.admin@example.com` — phần Quản lý viết theo quyền Admin) và
 * 13 lỗi DEMO trong danh mục lỗi công đoạn (In/Ép/QC sau ép/Đóng hàng); mã lỗi ghi ra
 * `out/demo-stage-errors.json` cho capture.mjs lọc.
 */

/* eslint-disable no-console -- script CLI: console.log là đầu ra tiến độ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Nạp `scripts/dtf-guide/.env.local` (gitignore) — biến môi trường đã đặt sẵn thắng file. KHÔNG in giá trị. */
export function loadLocalEnv(dir = HERE) {
  const file = path.join(dir, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadLocalEnv();

const argv = process.argv.slice(2);
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const BASE = (process.env.DTF_API_BASE || 'http://127.0.0.1:3007/api/v1').replace(/\/$/, '');
const ADMIN = {
  email: process.env.DTF_ADMIN_EMAIL || '',
  password: process.env.DTF_ADMIN_PASSWORD || '',
};
const DEMO_PASSWORD = process.env.DTF_DEMO_PASSWORD || '';
if (!ADMIN.email || !ADMIN.password || !DEMO_PASSWORD) {
  console.error('BLOCKED: thiếu DTF_ADMIN_EMAIL / DTF_ADMIN_PASSWORD / DTF_DEMO_PASSWORD (đặt trong scripts/dtf-guide/.env.local).');
  process.exit(3);
}
const FLOW_TYPE = process.env.DTF_FLOW_TYPE || 'no-sew';
const AUTO_PACK = process.env.DTF_AUTO_PACK === '1';
const STAGES = (argValue('--stages') || 'print,press').split(',').map((s) => s.trim()).filter(Boolean);
const TOUCH_DATES = !argv.includes('--no-touch-dates');

const ALL_STAGES = ['print', 'press', 'qc-post-press', 'sew-in', 'sew-out', 'pack'];
for (const s of STAGES) {
  if (!ALL_STAGES.includes(s)) throw new Error(`--stages: công đoạn không hợp lệ "${s}"`);
}

// ─────────────────────────────────────────────────────────── CHẶN CỨNG LOCALHOST
{
  const host = new URL(BASE).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    console.error(`TỪ CHỐI: DTF_API_BASE trỏ tới "${host}" — script chỉ chạy vào API localhost.`);
    process.exit(2);
  }
}

// ─────────────────────────────────────────────────────────── HẰNG SỐ DEMO
export const DEMO = {
  factory: { name: 'DEMO Xưởng DTF', shortName: 'DEMO-DTF' },
  product: { fullName: 'DEMO DTF Camo Shirt', shortName: 'DEMO DTF CAMO', designReviewCode: 'DEMO' },
  customer: { userSku: 'DEMO-SHOP', userEmail: 'demo-shop@example.com' },
  accounts: {
    support: { email: 'demo.support@example.com', fullName: 'Demo Support', role: 'Support' },
    leader: { email: 'demo.leader@example.com', fullName: 'Demo Designer Leader', role: 'DesignerLeader' },
    designerA: { email: 'demo.designer.a@example.com', fullName: 'Demo Designer A', role: 'Designer' },
    designerB: { email: 'demo.designer.b@example.com', fullName: 'Demo Designer B', role: 'Designer' },
    // USER chốt 11/09/2026: phần Quản lý viết theo quyền Admin (Manager không tạo user, không dọn tồn Đóng hàng).
    admin: { email: 'demo.admin@example.com', fullName: 'Demo Quản lý (Admin)', role: 'Admin' },
    'fulfillment-print': { email: 'demo.in@example.com', fullName: 'Demo In', role: 'Fulfillment', stage: 'print' },
    'fulfillment-press': { email: 'demo.ep@example.com', fullName: 'Demo Ép', role: 'Fulfillment', stage: 'press' },
    'fulfillment-qc-post-press': { email: 'demo.qc@example.com', fullName: 'Demo QC sau ép', role: 'Fulfillment', stage: 'qc-post-press' },
    'fulfillment-pack': { email: 'demo.donghang@example.com', fullName: 'Demo Đóng hàng', role: 'Fulfillment', stage: 'pack' },
  },
  assetBase: `http://127.0.0.1:${process.env.DTF_ASSET_PORT || 3098}`,
};

// ─────────────────────────────────────────────────────────── HTTP
class ApiError extends Error {
  constructor(status, body, where) {
    super(`${where} → HTTP ${status}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = text;
  }
  if (!res.ok || (json && json.success === false)) throw new ApiError(res.status, json, `${method} ${path}`);
  return json;
}

async function login(email, password) {
  const res = await call(null, 'POST', '/auth/login', { email, password, recaptchaToken: '' });
  // POST /auth/login trả phẳng `{ userId, accessToken, user }` (không bọc `data`).
  const token = res?.accessToken ?? res?.data?.accessToken;
  if (!token) throw new Error(`Đăng nhập ${email}: không có accessToken`);
  return token;
}

const log = (...a) => console.log(...a);

// ─────────────────────────────────────────────────────────── MAIN
let adminToken;
try {
  adminToken = await login(ADMIN.email, ADMIN.password);
} catch (err) {
  console.error(`BLOCKED: không đăng nhập được tài khoản admin local (${ADMIN.email}) — ${err.message}`);
  console.error('Đặt DTF_ADMIN_EMAIL / DTF_ADMIN_PASSWORD của một tài khoản SuperAdmin/Admin LOCAL rồi chạy lại.');
  console.error('Script KHÔNG tự sửa mật khẩu hay ghi DB.');
  process.exit(3);
}
log(`✓ đăng nhập admin local (${BASE})`);

// Vai → roleId
const rolesRes = await call(adminToken, 'GET', '/roles?page=1&limit=100');
const roleIdByName = new Map((rolesRes.data || []).map((r) => [r.name, r._id]));
for (const need of ['Support', 'DesignerLeader', 'Designer', 'Admin', 'Fulfillment']) {
  if (!roleIdByName.get(need)) throw new Error(`Không tìm thấy role "${need}"`);
}

// 1) Xưởng demo — cùng flowType/autoCompletePack với MLDTF
const facRes = await call(adminToken, 'GET', '/factories?page=1&limit=200');
let factory = (facRes.data || []).find((f) => f.shortName === DEMO.factory.shortName);
if (!factory) {
  factory = (await call(adminToken, 'POST', '/factories', { ...DEMO.factory, isActive: true, flowType: FLOW_TYPE, autoCompletePack: AUTO_PACK })).data;
  log(`+ tạo xưởng ${factory.shortName} (${factory._id})`);
} else if (factory.flowType !== FLOW_TYPE || !!factory.autoCompletePack !== AUTO_PACK) {
  factory = (await call(adminToken, 'PATCH', `/factories/${factory._id}`, { flowType: FLOW_TYPE, autoCompletePack: AUTO_PACK })).data;
  log(`~ cập nhật luồng xưởng ${DEMO.factory.shortName} → ${FLOW_TYPE}, autoCompletePack=${AUTO_PACK}`);
} else {
  log(`= xưởng ${factory.shortName} đã có`);
}
const factoryId = factory._id;

// 2) Sản phẩm demo printMethod=dtf gắn xưởng demo (máy "In và ép nhiệt" nếu có — giống sản phẩm DTF thật)
const pcRes = await call(adminToken, 'GET', `/product-configs?page=1&limit=50&fullName=${encodeURIComponent(DEMO.product.fullName)}`);
let product = (pcRes.data || []).find((p) => p.fullName === DEMO.product.fullName);
if (!product) {
  let machineTypeId;
  try {
    const mt = await call(adminToken, 'GET', '/machine-types?page=1&limit=100');
    machineTypeId = (mt.data || []).find((m) => m.name === 'In và ép nhiệt')?._id;
  } catch {
    machineTypeId = undefined;
  }
  product = (
    await call(adminToken, 'POST', '/product-configs', {
      ...DEMO.product,
      status: 'active',
      factoryId,
      ...(machineTypeId ? { machineTypeId } : {}),
      printMethod: 'dtf',
      productLine: '2d',
      mockup: `${DEMO.assetBase}/dtf-mockup-1.svg`,
    })
  ).data;
  log(`+ tạo sản phẩm ${product.fullName}`);
} else {
  log(`= sản phẩm ${product.fullName} đã có`);
}

// 3) Tài khoản demo
const tokens = {};
async function ensureAccount(key) {
  const acc = DEMO.accounts[key];
  try {
    tokens[key] = await login(acc.email, DEMO_PASSWORD);
    log(`= tài khoản ${acc.email} đã có`);
    return;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  const body = {
    fullName: acc.fullName,
    email: acc.email,
    password: DEMO_PASSWORD,
    roleId: roleIdByName.get(acc.role),
    otherPermissionIds: [],
    ...(acc.role === 'Fulfillment' ? { factoryId, fulfillmentStage: acc.stage } : {}),
  };
  try {
    if (acc.role === 'Designer') {
      // Designer tạo qua trang Team của Leader (đúng đường nghiệp vụ) — admin cũng được gọi.
      await call(adminToken, 'POST', '/designer/team', { fullName: acc.fullName, email: acc.email, password: DEMO_PASSWORD });
    } else {
      await call(adminToken, 'POST', '/users', body);
    }
  } catch (err) {
    if (err instanceof ApiError && /already|exist/i.test(JSON.stringify(err.body))) {
      throw new Error(`Email ${acc.email} đã tồn tại nhưng KHÔNG đăng nhập được bằng DTF_DEMO_PASSWORD — script không tự đổi mật khẩu.`);
    }
    throw err;
  }
  tokens[key] = await login(acc.email, DEMO_PASSWORD);
  log(`+ tạo tài khoản ${acc.email} (${acc.role}${acc.stage ? ' · ' + acc.stage : ''})`);
}

for (const k of ['support', 'leader', 'designerA', 'designerB', 'admin']) await ensureAccount(k);
for (const s of STAGES) {
  const key = `fulfillment-${s}`;
  if (!DEMO.accounts[key]) throw new Error(`Chưa khai tài khoản demo cho công đoạn ${s}`);
  await ensureAccount(key);
}
const me = async (key) => (await call(tokens[key], 'GET', '/auth/me')).data;
const designerAId = (await me('designerA'))._id;
const designerBId = (await me('designerB'))._id;

/** Token của người làm công đoạn `stage`: công nhân demo nếu có, không thì Admin demo làm thay (OVERRIDE_ROLES). */
const stageActor = (stage) => tokens[`fulfillment-${stage}`] || tokens.admin;

// 3b) Danh mục lỗi DEMO theo công đoạn DTF — CHỈ DB local, qua POST /workshop-config/stage-errors.
// Tạo bằng chính công nhân công đoạn đó (đúng đường nghiệp vụ: công nhân tự thêm lỗi cho trạm mình);
// không có công nhân demo thì Admin demo tạo. Trùng tên trong cùng công đoạn → dùng lại (idempotent).
// Mã do BE tự sinh `se-<stage>-<n>` → ghi danh sách mã ra out/demo-stage-errors.json để capture.mjs
// chỉ giữ lỗi DEMO khi chụp danh mục / bảng barcode / dialog chọn lỗi. KHÔNG sửa/ẩn lỗi thật.
const DEMO_STAGE_ERRORS = {
  print: [
    { name: 'File in bị vỡ nét', reworkTarget: 'designer' },
    { name: 'Sai kích thước hình in', reworkTarget: 'designer' },
    { name: 'Không mở được file in', reworkTarget: 'tool-check' },
  ],
  press: [
    { name: 'Hình in bong tróc sau ép', reworkTarget: 'print' },
    { name: 'Ép lệch vị trí so với mẫu', reworkTarget: 'print' },
    { name: 'Màu in khác mockup', reworkTarget: 'designer' },
  ],
  'qc-post-press': [
    { name: 'Hình in nứt khi kéo giãn', reworkTarget: 'press' },
    { name: 'Áo ố vàng do nhiệt ép', reworkTarget: 'press' },
    { name: 'Hình in lệch tâm áo', reworkTarget: 'print' },
    { name: 'Hình in sai so với đơn', reworkTarget: 'designer' },
  ],
  pack: [
    { name: 'Sai size so với đơn', reworkTarget: 'qc-post-press' },
    { name: 'Áo bẩn khi gấp đóng gói', reworkTarget: 'qc-post-press' },
    { name: 'Hình in trầy xước', reworkTarget: 'press' },
  ],
};
const demoStageErrors = [];
let stageErrorsCreated = 0;
for (const [stage, list] of Object.entries(DEMO_STAGE_ERRORS)) {
  const actor = tokens[`fulfillment-${stage}`] || tokens.admin;
  const current = (await call(adminToken, 'GET', `/workshop-config/stage-errors?stage=${stage}`)).data || [];
  for (const e of list) {
    let row = current.find((r) => r.name.trim().toLowerCase() === e.name.toLowerCase());
    if (!row) {
      row = (await call(actor, 'POST', '/workshop-config/stage-errors', { name: e.name, reworkTarget: e.reworkTarget, stage })).data;
      stageErrorsCreated++;
      log(`+ lỗi demo [${stage}] ${e.name} → ${e.reworkTarget} (${row.code})`);
    } else if (row.reworkTarget !== e.reworkTarget) {
      throw new Error(`Lỗi "${e.name}" ở ${stage} đã có với đích ${row.reworkTarget} ≠ ${e.reworkTarget} — có thể là lỗi THẬT, đổi tên lỗi demo.`);
    }
    demoStageErrors.push({ stage, code: row.code, name: row.name, reworkTarget: row.reworkTarget });
  }
}
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out/demo-stage-errors.json'), JSON.stringify(demoStageErrors, null, 2) + '\n');
log(`${stageErrorsCreated ? '+' : '='} lỗi demo: ${demoStageErrors.length} (tạo mới ${stageErrorsCreated})`);

// 4) Đơn demo — mỗi đơn 1 kịch bản trạng thái
const COLORS = ['Green Camo', 'Desert Camo', 'Urban Camo', 'Black Camo'];
const SIZES = ['S', 'M', 'L', 'XL', '2XL'];
const RECIPIENTS = ['Alex Carter', 'Jamie Lee', 'Taylor Morgan', 'Jordan Blake', 'Casey Reed', 'Riley Brooks'];

/** code → { group, scenario, note } — `note` là mô tả trạng thái để người soát seed. */
const SCENARIOS = [
  // ── Soát tool (Support)
  ['01', 'unreviewed', 'Chưa soát tool'],
  ['02', 'unreviewed', 'Chưa soát tool'],
  ['03', 'unreviewed', 'Chưa soát tool'],
  ['04', 'tool-error', 'Soát lỗi → chờ gán designer'],
  ['05', 'tool-error', 'Soát lỗi → chờ gán designer'],
  ['06', 'tool-no-pdf', 'Không có file PDF → chờ gán designer'],
  // ── Designer
  ['07', 'designer-assigned-a', 'Đã gán Designer A (Cần làm)'],
  ['08', 'designer-assigned-a', 'Đã gán Designer A (Cần làm)'],
  ['09', 'designer-in-progress-a', 'Designer A đang làm'],
  ['10', 'designer-done-b', 'Designer B xong → In đang chờ'],
  ['11', 'designer-rework-a', 'In báo lỗi thiết kế → Designer A Cần làm lại, In Đang chờ quay lại'],
  ['12', 'toolcheck-hold', 'In báo Thiếu file để in → Support Cần làm lại, In Đang chờ quay lại'],
  // ── Fulfillment
  ['13', 'print-waiting', 'Soát OK → In Đang chờ'],
  ['14', 'print-waiting', 'Soát OK → In Đang chờ'],
  ['15', 'print-in-progress', 'In Đang làm'],
  ['16', 'press-waiting', 'In xong → Ép Đang chờ'],
  ['17', 'press-waiting', 'In xong → Ép Đang chờ'],
  ['18', 'press-in-progress', 'Ép Đang làm'],
  ['19', 'qc-waiting', 'Ép xong → QC sau ép Đang chờ'],
  ['20', 'qc-waiting', 'Ép xong → QC sau ép Đang chờ'],
  ['21', 'qc-in-progress', 'QC sau ép Đang làm'],
  ['22', 'pack-waiting', 'QC xong → May tự xong → Đóng hàng Đang chờ'],
  ['23', 'pack-waiting', 'QC xong → May tự xong → Đóng hàng Đang chờ'],
  ['24', 'completed', 'Đóng hàng xong → hoàn thành'],
  ['25', 'press-rework-to-print', 'Ép đẩy về In → In Cần làm lại, Ép Đang chờ quay lại'],
  ['26', 'qc-error-to-print', 'QC báo lỗi In → In Cần làm lại, Ép + QC Đang chờ quay lại'],
  ['27', 'held', 'Đang giữ (Đợi khách sửa thông tin đơn)'],
  ['28', 'designer-watching-a', 'Designer A xong → In báo Thiếu file để in → Designer A Đang chờ quay lại'],
  // ── Thêm cho lượt chụp In/Ép/QC/Đóng hàng/Admin (DEV-07)
  // 29 bị TIÊU HAO khi chụp: capture.mjs quét `N-DEMO-DTF-29` rồi `OK` ở trang Quét mã của Đóng hàng → đơn hoàn thành.
  // Đơn đã hoàn thành thì capture bỏ qua ảnh đó và giữ ảnh cũ trong manifest (xem capture.mjs `captureFulfillment('pack')`).
  ['29', 'pack-waiting', 'QC xong → Đóng hàng Đang chờ (ảnh quét hoàn thành — bị tiêu hao)'],
  ['30', 'pack-in-progress', 'Đóng hàng Đang làm (ảnh Báo lỗi ở Đóng hàng)'],
];

const codeOf = (n) => `DEMO-DTF-${n}`;
const nowIso = () => new Date().toISOString();

function rowFor([n], idx) {
  const color = COLORS[idx % COLORS.length];
  const size = SIZES[idx % SIZES.length];
  const who = RECIPIENTS[idx % RECIPIENTS.length];
  return {
    productionId: codeOf(n),
    userSku: DEMO.customer.userSku,
    userEmail: DEMO.customer.userEmail,
    type: DEMO.product.fullName,
    color,
    size,
    quantity: 1,
    printMethod: 'dtf',
    mockupUrl: `${DEMO.assetBase}/dtf-mockup-${(idx % 4) + 1}.svg`,
    designs: {
      front: `${DEMO.assetBase}/dtf-design-front-${n}.svg`,
      back: `${DEMO.assetBase}/dtf-design-back-${n}.svg`,
    },
    orderId: `DEMO-ORDER-${n}`,
    externalId: `DEMO-EXT-${n}`,
    ...(TOUCH_DATES ? { inProductionAt: nowIso(), orderAt: nowIso() } : {}),
    shippingAddress: {
      name: `${who} (DEMO)`,
      address1: `${100 + idx} Demo Street`,
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      country: 'US',
    },
  };
}

// Đơn nào đã có thì bỏ kịch bản; đơn mới import rồi chạy kịch bản.
const existing = new Map();
for (const s of SCENARIOS) {
  try {
    const r = await call(adminToken, 'GET', `/orders/by-production-id/${codeOf(s[0])}`);
    existing.set(s[0], r.data);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
}
const toImport = SCENARIOS.map((s, i) => ({ s, i })).filter(({ s }) => !existing.has(s[0]) || TOUCH_DATES);
if (toImport.length) {
  // shippingAddress có schema riêng — nếu BE từ chối thì import lại không kèm địa chỉ.
  let rows = toImport.map(({ s, i }) => rowFor(s, i));
  try {
    await call(adminToken, 'POST', '/orders/import', { rows });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 400) throw err;
    rows = rows.map(({ shippingAddress: _shippingAddress, ...r }) => r);
    await call(adminToken, 'POST', '/orders/import', { rows });
  }
  log(`${existing.size ? '~' : '+'} import ${rows.length} dòng đơn demo (${existing.size} đơn đã có — chỉ dời mốc ngày)`);
}

const idOf = new Map();
for (const s of SCENARIOS) {
  const r = await call(adminToken, 'GET', `/orders/by-production-id/${codeOf(s[0])}`);
  if (r.data?.factoryId !== factoryId) throw new Error(`${codeOf(s[0])} không map vào xưởng demo (factoryId=${r.data?.factoryId}) — kiểm tên sản phẩm demo`);
  idOf.set(s[0], r.data._id);
}

// Thao tác nguyên tử
const setField = (key, n, field, value) => call(tokens[key], 'PATCH', `/orders/${idOf.get(n)}/field`, { field, value });
const toolOk = (n) => setField('support', n, 'toolResultNote', 'ok');
const toolError = async (n, note = 'error') => {
  await setField('support', n, 'errorFile', ['front']);
  await setField('support', n, 'errorFileNote', 'DEMO — file thân trước lệch khung in');
  await setField('support', n, 'toolResultNote', note);
};
const assign = (ns, userId) => call(tokens.leader, 'POST', '/orders/bulk-assign-designer', { ids: ns.map((n) => idOf.get(n)), userId, reassignOthers: false, skipUnreviewed: false });
const dz = (key, n, action) => call(tokens[key], 'POST', `/orders/${idOf.get(n)}/designer-transition`, { action });
const ff = (stage, n, action, extra = {}) => call(stageActor(stage), 'POST', `/orders/${idOf.get(n)}/fulfillment-transition`, { stage, action, ...extra });
const pass = async (stage, n) => {
  await ff(stage, n, 'start');
  await ff(stage, n, 'complete');
};
const setError = (actorToken, n, body) => call(actorToken, 'POST', `/orders/${idOf.get(n)}/set-production-error`, body);

const RUN = {
  unreviewed: async () => {},
  'tool-error': (n) => toolError(n),
  'tool-no-pdf': (n) => toolError(n, 'no-pdf'),
  'designer-assigned-a': async (n) => {
    await toolError(n);
    await assign([n], designerAId);
  },
  'designer-in-progress-a': async (n) => {
    await toolError(n);
    await assign([n], designerAId);
    await dz('designerA', n, 'start');
  },
  'designer-done-b': async (n) => {
    await toolError(n);
    await assign([n], designerBId);
    await dz('designerB', n, 'start');
    await dz('designerB', n, 'complete');
  },
  'designer-rework-a': async (n) => {
    await toolError(n);
    await assign([n], designerAId);
    await dz('designerA', n, 'start');
    await dz('designerA', n, 'complete');
    // Công nhân In báo lỗi nguồn designer trên đơn đang chờ In → designer "Cần làm lại".
    await setError(stageActor('print'), n, { code: 'wrong-design', note: 'DEMO — design thân sau bị mờ, cần xuất lại file' });
  },
  'designer-watching-a': async (n) => {
    await toolError(n);
    await assign([n], designerAId);
    await dz('designerA', n, 'start');
    await dz('designerA', n, 'complete');
    await setError(stageActor('print'), n, { code: 'tool-missing-file', note: 'DEMO — thiếu file vị trí ngực trái' });
  },
  'toolcheck-hold': async (n) => {
    await toolOk(n);
    await setError(stageActor('print'), n, { code: 'tool-missing-file', note: 'DEMO — thiếu file tay áo' });
  },
  'print-waiting': (n) => toolOk(n),
  'print-in-progress': async (n) => {
    await toolOk(n);
    await ff('print', n, 'start');
  },
  'press-waiting': async (n) => {
    await toolOk(n);
    await pass('print', n);
  },
  'press-in-progress': async (n) => {
    await toolOk(n);
    await pass('print', n);
    await ff('press', n, 'start');
  },
  'qc-waiting': async (n) => {
    await toolOk(n);
    await pass('print', n);
    await pass('press', n);
  },
  'qc-in-progress': async (n) => {
    await toolOk(n);
    await pass('print', n);
    await pass('press', n);
    await ff('qc-post-press', n, 'start');
  },
  'pack-waiting': async (n) => {
    await toolOk(n);
    await pass('print', n);
    await pass('press', n);
    await pass('qc-post-press', n); // no-sew: May vào + May ra tự hoàn thành
  },
  'pack-in-progress': async (n) => {
    await toolOk(n);
    await pass('print', n);
    await pass('press', n);
    await pass('qc-post-press', n);
    await ff('pack', n, 'start');
  },
  completed: async (n) => {
    await toolOk(n);
    await pass('print', n);
    await pass('press', n);
    await pass('qc-post-press', n);
    await pass('pack', n);
  },
  'press-rework-to-print': async (n) => {
    await toolOk(n);
    await pass('print', n);
    await ff('press', n, 'start');
    await ff('press', n, 'rework-back', { target: 'print', reason: 'DEMO — hình in bong mép sau khi ép' });
  },
  'qc-error-to-print': async (n) => {
    await toolOk(n);
    await pass('print', n);
    await pass('press', n);
    await ff('qc-post-press', n, 'start');
    await setError(stageActor('qc-post-press'), n, { code: 'print-misalign', note: 'DEMO — in lệch tâm 2cm', target: 'print' });
  },
  held: async (n) => {
    await toolOk(n);
    await call(tokens.admin, 'POST', `/orders/${idOf.get(n)}/hold`, { reason: 'Đợi khách sửa thông tin đơn' });
  },
};

const summary = {};
for (const [n, scenario, note] of SCENARIOS) {
  summary[scenario] = (summary[scenario] || 0) + 1;
  if (existing.has(n)) continue;
  try {
    await RUN[scenario](n);
    log(`  ${codeOf(n)} · ${note}`);
  } catch (err) {
    console.error(`  ✗ ${codeOf(n)} (${scenario}): ${err.message}`);
    process.exitCode = 1;
  }
}

log('\nTổng đơn demo theo kịch bản:');
for (const [k, v] of Object.entries(summary)) log(`  ${k.padEnd(24)} ${v}`);
log(`\nXưởng demo: ${DEMO.factory.shortName} (${factoryId}) · flowType=${FLOW_TYPE} · autoCompletePack=${AUTO_PACK}`);
log(`Tài khoản công nhân demo: ${STAGES.join(', ')} (công đoạn khác do ${DEMO.accounts.admin.email} làm thay)`);
