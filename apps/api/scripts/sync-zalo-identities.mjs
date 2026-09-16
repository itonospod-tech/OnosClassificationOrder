/**
 * Nạp DANH SÁCH NGƯỜI GỬI trong các nhóm Zalo từ `onosnew` vào OnosFactory.
 *
 * Vì sao cần bảng này: engine chỉ đánh dấu `sender_type='self'` cho các tài
 * khoản công ty nối trực tiếp vào nó (đo 30/08: đúng 2 tài khoản). Nhân viên
 * dùng Zalo cá nhân — Ngọc Mai 46 nhóm, Thuy Thanh 40, Huyền 26 — đều nằm
 * trong `contact` y hệt khách. Không có bảng này thì mô hình phải tự đoán ai
 * là nhân viên, và bản tóm tắt "29/08 Huyền trả lời…" chỉ là phỏng đoán.
 *
 * Khoá là `zalo_uid`, KHÔNG phải tên: cùng uid `623149364320559023` từng mang
 * hai tên ("Ceo Onos", "Onos Ai"), và tên "Onos" thuộc hai uid khác nhau.
 *
 * Cách chạy (từ thư mục apps/api):
 *   node scripts/sync-zalo-identities.mjs --dry-run
 *   node scripts/sync-zalo-identities.mjs --yes --token <JWT>
 *
 * NGUỒN ĐỔI 11/09/2026: trước đây đọc engine ở `onosceo`. Các nick đã dời sang
 * engine prod trên `onosnew`, toàn bộ lịch sử cũ (179 nhóm · 29.784 tin từ
 * 18/08) đã chuyển sang đó, và engine cũ đã dừng hẳn. Đổi nguồn bằng cờ
 * `--ssh/--container/--db` nếu cần đọc lại máy cũ (phải bật container lên trước).
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const args = process.argv.slice(2);
const apply = args.includes('--yes');
const argOf = (n) => {
  const i = args.indexOf(n);

  return i >= 0 ? args[i + 1] : undefined;
};

const SSH_HOST = argOf('--ssh') || 'onosnew';
const PG = argOf('--container') || 'onos-zalo-engine-db';
const PG_DB = argOf('--db') || 'zalo_engine';
const API = (argOf('--api') || 'http://127.0.0.1:3007/api/v1').replace(/\/+$/, '');
const TOKEN = argOf('--token') || process.env.ONOS_TOKEN;
const SEP = '';

async function psql(sql) {
  const { stdout } = await execFile('ssh', [
    '-o',
    'BatchMode=yes',
    SSH_HOST,
    `docker exec ${PG} psql -U zalo -d ${PG_DB} -At -F'${SEP}' -c ${JSON.stringify(sql.replace(/\s+/g, ' '))}`,
  ]);

  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(SEP));
}

// Tài khoản công ty nối vào engine — những uid này là tài khoản trực nhóm
// (trợ lý AI), tách riêng khỏi nhân viên dùng Zalo cá nhân.
const congTy = new Set((await psql(`SELECT zalo_uid FROM zalo_accounts WHERE zalo_uid IS NOT NULL`)).map((r) => r[0]));

const rows = await psql(`
  SELECT m.sender_uid,
         max(m.sender_name)                        AS ten,
         count(DISTINCT c.group_global_id)         AS so_nhom,
         count(*)                                  AS so_tin,
         string_agg(DISTINCT c.group_global_id, ',') AS cac_nhom
  FROM zalo_messages m
  JOIN zalo_conversations c ON c.id = m.conversation_id
  WHERE c.group_global_id IS NOT NULL
    AND m.sender_uid IS NOT NULL AND m.sender_uid <> ''
  GROUP BY 1
`);

const identities = rows.map(([zaloUid, ten, soNhom, soTin, cacNhom]) => ({
  zaloUid,
  displayName: ten || undefined,
  groupCount: Number(soNhom),
  messageCount: Number(soTin),
  laTaiKhoanCongTy: congTy.has(zaloUid),
  // API nhìn LOẠI của các nhóm này: 1 nhóm vận hành → đối tác, không phải khách.
  groupGlobalIds: (cacNhom || '').split(',').filter(Boolean),
}));

// Cùng ngưỡng với `ZALO_STAFF_MIN_GROUPS` phía API — chỉ để in ra cho người
// chạy thấy trước, quyết định thật vẫn do API làm.
const nv = identities.filter((i) => !i.laTaiKhoanCongTy && i.groupCount >= 5).length;
const kh = identities.filter((i) => !i.laTaiKhoanCongTy && i.groupCount === 1).length;
const mapMo = identities.length - nv - kh - identities.filter((i) => i.laTaiKhoanCongTy).length;

console.log(`Nguồn : ssh ${SSH_HOST} → ${PG}`);
console.log(`Đích  : ${API}/zalo-groups/identities/sync`);
console.log(`Đọc   : ${identities.length} người gửi`);
console.log(`        ${identities.filter((i) => i.laTaiKhoanCongTy).length} tài khoản công ty · ${nv} có thể là nhân viên (≥5 nhóm) · ${kh} có thể là khách (1 nhóm) · ${mapMo} cần người xét`);
console.log(`Chế độ: ${apply ? 'ĐẨY THẬT (--yes)' : 'DRY-RUN (thêm --yes để đẩy)'}`);
console.log('');

if (!apply) {
  console.log('  Ứng viên nhân viên (nhiều nhóm nhất):');
  for (const i of identities.filter((x) => !x.laTaiKhoanCongTy).sort((a, b) => b.groupCount - a.groupCount).slice(0, 12)) {
    console.log(`    ${(i.displayName ?? i.zaloUid).padEnd(24)} ${String(i.groupCount).padStart(3)} nhóm · ${i.messageCount} tin`);
  }
  process.exit(0);
}

if (!TOKEN) {
  console.error('Thiếu token. Truyền --token <JWT> hoặc đặt ONOS_TOKEN.');
  process.exit(1);
}

const res = await fetch(`${API}/zalo-groups/identities/sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ identities }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Lỗi HTTP ${res.status}:`, JSON.stringify(body).slice(0, 400));
  process.exit(1);
}

const d = body.data ?? {};
console.log(`Xong: tạo mới ${d.created} · cập nhật ${d.updated} · máy đề xuất được ${d.suggested}`);
console.log('');
console.log('Bước tiếp: mở tab "Ai là ai" để duyệt, hoặc gọi');
console.log('  POST /zalo-groups/identities/apply-suggestions  (áp hàng loạt phần chắc chắn)');
