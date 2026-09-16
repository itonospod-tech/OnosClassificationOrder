/**
 * Nạp nhóm Zalo từ máy `onosceo` vào OnosFactory.
 *
 * Zalo sống ở `onosnew` (engine + Postgres riêng, cổng engine chỉ nghe
 * 127.0.0.1). Chừng nào hai máy chưa chung tailnet thì API OnosFactory không
 * gọi thẳng engine được, nên script này chạy TỪ MỘT MÁY CÓ SSH tới cả hai:
 * đọc Postgres qua `ssh`, gộp dòng, rồi POST vào `/zalo-groups/sync`.
 *
 * Khi hai máy đã thông nhau thì thay thân hàm `docGroups()` bằng lời gọi engine
 * — phần gộp và phần đẩy bên dưới giữ nguyên.
 *
 * ⚠️ VÌ SAO PHẢI GỘP: engine lưu MỘT bản ghi hội thoại cho MỖI nick công ty có
 * mặt trong nhóm. Đo trên prod `onosceo` 29/08: 157 dòng hội thoại nhóm = 147
 * nhóm thật. Đẩy thẳng 157 dòng lên là người vận hành phải gắn cùng một nhóm
 * nhiều lần, sót một lần là hụt dữ liệu của nick đó.
 *
 * Cách chạy (từ thư mục apps/api):
 *   node scripts/sync-zalo-groups.mjs --dry-run
 *   node scripts/sync-zalo-groups.mjs --yes --api https://api-dev-onos.autonow.vn/api/v1 --token <JWT>
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
const argOf = (name) => {
  const i = args.indexOf(name);

  return i >= 0 ? args[i + 1] : undefined;
};

const SSH_HOST = argOf('--ssh') || 'onosnew';
const PG_CONTAINER = argOf('--container') || 'onos-zalo-engine-db';
const PG_DB = argOf('--db') || 'zalo_engine';
const API = (argOf('--api') || 'http://127.0.0.1:3007/api/v1').replace(/\/+$/, '');
const TOKEN = argOf('--token') || process.env.ONOS_TOKEN;

/** Ký tự phân tách cột — chọn chuỗi không xuất hiện trong tên nhóm Zalo. */
const SEP = '';

/**
 * Đọc các dòng hội thoại NHÓM từ Postgres của engine.
 *
 * `left_at IS NULL` — bỏ nhóm mà mọi nick đã rời: chúng không còn tin mới, đưa
 * vào danh sách chờ gắn chỉ tổ làm nhiễu.
 */
async function docGroups() {
  /**
   * Mốc tin cuối đếm ĐÚNG những tin bộ tóm tắt đọc được: bỏ tin đã THU HỒI và tin
   * rỗng. Cột `last_message_at` của engine đếm cả hai, nên nhóm mà tin mới nhất là
   * tin thu hồi sẽ kẹt VĨNH VIỄN — hàng đợi lần nào cũng gọi nó, kéo về 0 dòng rồi
   * bỏ qua, còn huy hiệu "có tin mới chưa tóm tắt" thì sáng mãi. Đo 04/09 trên dữ
   * liệu thật: 3/153 nhóm lệch mốc, 0 nhóm mất hẳn mốc.
   *
   * KHÔNG đặt chú thích bằng `--` bên trong chuỗi SQL dưới đây: nó bị
   * `.replace(/\s+/g, ' ')` gộp thành một dòng và sẽ nuốt phần còn lại của câu.
   */
  const sql = `
    SELECT c.group_global_id,
           coalesce(max(c.title), '')                      AS title,
           string_agg(DISTINCT c.id::text, ',')            AS conversation_ids,
           coalesce(string_agg(DISTINCT a.display_name, ','), '') AS member_nicks,
           to_char(max(m.sent_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_message_at
    FROM zalo_conversations c
    LEFT JOIN zalo_accounts a ON a.id = c.zalo_account_id
    LEFT JOIN zalo_messages m
           ON m.conversation_id = c.id
          AND m.is_deleted = false
          AND btrim(coalesce(m.content, '')) <> ''
    WHERE c.group_global_id IS NOT NULL AND c.left_at IS NULL
    GROUP BY c.group_global_id
  `.replace(/\s+/g, ' ');

  const { stdout } = await execFile('ssh', [
    '-o',
    'BatchMode=yes',
    SSH_HOST,
    `docker exec ${PG_CONTAINER} psql -U zalo -d ${PG_DB} -At -F'${SEP}' -c ${JSON.stringify(sql)}`,
  ]);

  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [groupGlobalId, title, convIds, nicks, lastAt] = line.split(SEP);

      return {
        groupGlobalId,
        title: title || undefined,
        conversationIds: convIds ? convIds.split(',').filter(Boolean) : [],
        memberNicks: nicks ? nicks.split(',').filter(Boolean) : [],
        lastMessageAt: lastAt || undefined,
      };
    })
    .filter((g) => g.groupGlobalId);
}

const groups = await docGroups();
const soHoiThoai = groups.reduce((n, g) => n + g.conversationIds.length, 0);

console.log(`Nguồn    : ssh ${SSH_HOST} → ${PG_CONTAINER}`);
console.log(`Đích     : ${API}/zalo-groups/sync`);
console.log(`Đọc được : ${soHoiThoai} dòng hội thoại → ${groups.length} nhóm thật`);
console.log(`Chế độ   : ${apply ? 'ĐẨY THẬT (--yes)' : 'DRY-RUN (thêm --yes để đẩy)'}`);
console.log('');

if (!apply) {
  for (const g of groups.slice(0, 10)) {
    console.log(`  ${(g.title || '(không tên)').slice(0, 46).padEnd(48)} ${g.conversationIds.length} hội thoại`);
  }
  if (groups.length > 10) console.log(`  … và ${groups.length - 10} nhóm nữa`);
  process.exit(0);
}

if (!TOKEN) {
  console.error('Thiếu token. Truyền --token <JWT> hoặc đặt biến môi trường ONOS_TOKEN.');
  process.exit(1);
}

const res = await fetch(`${API}/zalo-groups/sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ groups }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Lỗi HTTP ${res.status}:`, JSON.stringify(body).slice(0, 400));
  process.exit(1);
}

const d = body.data ?? {};
console.log(`Xong: tạo mới ${d.created} · cập nhật ${d.updated} · từ ${d.rawConversations} dòng hội thoại`);
