/**
 * So dữ liệu giữa HAI engine Zalo để biết khi nào tắt được engine cũ.
 *
 * Bối cảnh (11/09/2026): các nick Zalo đã dời từ `onosceo` sang `onosnew`.
 * Phiên của `Onos Ai` và `Cfo` ở máy cũ đã thành `qr_pending` — tức bị đá khi
 * quét lại ở máy mới, nên máy cũ KHÔNG còn thu tin mới một cách thực chất.
 *
 * Nhưng tắt ngay thì mất thật: engine chỉ biết tới một nhóm sau khi đã kéo
 * được nhóm đó về, mà `Onos Ai` — nick phủ rộng nhất — lúc đo mới có 37/178
 * nhóm ở máy mới. Script này đo đúng phần chênh đó và nói thẳng đã tắt được
 * chưa, thay vì để người vận hành đoán.
 *
 * Chạy (từ máy có SSH tới cả hai):
 *   node scripts/check-zalo-engine-parity.mjs
 *   node scripts/check-zalo-engine-parity.mjs --days 14   # cửa sổ "nhóm còn sống"
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(n);

  return i >= 0 ? args[i + 1] : undefined;
};

/** Cửa sổ coi một nhóm là "còn sống" — nhóm im lặng lâu hơn thì mất cũng ít hệ quả. */
const DAYS = Number(argOf('--days') || 14);

const CU = { ten: 'onosceo (cũ)', ssh: 'onosceo', container: 'zalo-onos-zalo-db-1', db: 'zalo' };
const MOI = { ten: 'onosnew (mới)', ssh: 'onosnew', container: 'onos-zalo-engine-db', db: 'zalo_engine' };

async function psql({ ssh, container, db }, sql) {
  const { stdout } = await execFile('ssh', [
    '-o',
    'BatchMode=yes',
    ssh,
    `docker exec ${container} psql -U zalo -d ${db} -At -F'|' -c ${JSON.stringify(sql.replace(/\s+/g, ' '))}`,
  ]);

  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('|'));
}

/** Nhóm + lần nhắn cuối, khoá theo `group_global_id` (khoá dùng chung hai engine). */
const SQL_NHOM = `
  SELECT c.group_global_id, max(m.created_at)
  FROM zalo_conversations c
  LEFT JOIN zalo_messages m ON m.conversation_id = c.id
  WHERE c.group_global_id IS NOT NULL
  GROUP BY 1
`;

const SQL_NICK = `
  SELECT a.display_name, a.status, count(DISTINCT c.group_global_id)
  FROM zalo_accounts a
  LEFT JOIN zalo_conversations c ON c.zalo_account_id = a.id AND c.group_global_id IS NOT NULL
  GROUP BY 1, 2 ORDER BY 3 DESC
`;

const [nhomCu, nhomMoi, nickCu, nickMoi] = await Promise.all([
  psql(CU, SQL_NHOM),
  psql(MOI, SQL_NHOM),
  psql(CU, SQL_NICK),
  psql(MOI, SQL_NICK),
]);

const moi = new Set(nhomMoi.map(([g]) => g));
const moc = Date.now() - DAYS * 864e5;
const thieu = nhomCu.filter(([g]) => !moi.has(g));
const thieuSong = thieu.filter(([, mx]) => mx && new Date(mx).getTime() >= moc);

console.log(`Nhóm: ${CU.ten} ${nhomCu.length} · ${MOI.ten} ${nhomMoi.length} · chung ${nhomCu.length - thieu.length}`);
console.log(`Chỉ có ở máy cũ: ${thieu.length}, trong đó CÒN SỐNG (${DAYS} ngày): ${thieuSong.length}`);
console.log('');
console.log('Nick — số nhóm đã kéo về:');
const inNick = (rows, nhan) => {
  console.log(`  ${nhan}`);
  for (const [ten, trangThai, soNhom] of rows) console.log(`    ${String(ten).padEnd(18)} ${String(trangThai).padEnd(12)} ${soNhom} nhóm`);
};
inNick(nickCu, CU.ten);
inNick(nickMoi, MOI.ten);
console.log('');

if (thieuSong.length === 0) {
  console.log('✅ TẮT ĐƯỢC engine cũ: mọi nhóm còn sống đều đã có ở máy mới.');
  console.log('   (Lịch sử tin cũ vẫn chỉ nằm ở máy cũ — giữ container ở chế độ kho nếu cần tra lại.)');
} else {
  console.log(`⛔ CHƯA tắt được: còn ${thieuSong.length} nhóm đang dùng mà máy mới chưa có.`);
  console.log('   Engine chỉ biết tới một nhóm sau khi kéo được nhóm đó về, nên chờ thêm rồi đo lại.');
  console.log('   Nick nào ở máy mới có số nhóm thấp hơn hẳn máy cũ chính là nick chưa đồng bộ xong.');
  console.log('');
  console.log(`   ${Math.min(thieuSong.length, 10)} nhóm còn sống chưa có (group_global_id · nhắn lần cuối):`);
  for (const [g, mx] of thieuSong.slice(0, 10)) console.log(`     ${g}  ${String(mx).slice(0, 10)}`);
}
