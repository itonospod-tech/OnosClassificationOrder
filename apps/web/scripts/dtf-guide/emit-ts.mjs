/**
 * Sinh `apps/web/src/pages/guide/dtf/dtfShots.generated.ts` (ĐƯỢC COMMIT) cho trang hướng dẫn DTF theo vai.
 *
 * Vì sao cần: `capture.mjs` ghi hình học + lưới "mực" ra `scripts/dtf-guide/out/guideShots.generated.json` — thư mục
 * `out/` bị gitignore và script chụp CỐ Ý không ghi `.ts` khi API đang chạy (nodemon theo dõi `apps/**\/*.ts`).
 * Chạy script này SAU khi chụp xong (một lần, không song song với capture):
 *
 *   node apps/web/scripts/dtf-guide/emit-ts.mjs
 *
 * Kiểm chéo với `public/guide/dtf/manifest.json` trước khi ghi: đủ mọi bước, ảnh tồn tại, kích thước khớp, số và khung
 * chú thích khớp. Lệch → in lỗi, KHÔNG ghi file, thoát mã 1. Thứ tự khoá = thứ tự vai/bước trong manifest.
 *
 * Env: DTF_MANIFEST, DTF_SHOTS_OUT (json nguồn), DTF_TS_OUT (file đích). Tài liệu: DtfRoleGuide.md §6.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../..');
const PUBLIC_DIR = path.join(WEB, 'public/guide/dtf');
const MANIFEST = path.resolve(process.env.DTF_MANIFEST || path.join(PUBLIC_DIR, 'manifest.json'));
const SHOTS_JSON = path.resolve(process.env.DTF_SHOTS_OUT || path.join(HERE, 'out/guideShots.generated.json'));
const OUT_TS = path.resolve(process.env.DTF_TS_OUT || path.join(WEB, 'src/pages/guide/dtf/dtfShots.generated.ts'));

/** Sai số cho phép khi so toạ độ % giữa manifest và json (cả hai cùng làm tròn 1 chữ số). */
const EPS = 0.051;

const readJson = (file) => {
  if (!fs.existsSync(file)) {
    console.error(`Thiếu file: ${file}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const manifest = readJson(MANIFEST);
const shots = readJson(SHOTS_JSON);
const errors = [];
const entries = [];

for (const role of manifest) {
  for (const step of role.steps) {
    const key = step.file.replace(/\.webp$/, '');
    const where = `${key}`;
    const shot = shots[key];
    if (!shot) {
      errors.push(`${where}: không có trong ${path.basename(SHOTS_JSON)}`);
      continue;
    }
    if (!fs.existsSync(path.join(PUBLIC_DIR, step.file))) errors.push(`${where}: thiếu ảnh ${step.file}`);
    if (shot.file !== step.file) errors.push(`${where}: file ${shot.file} ≠ manifest ${step.file}`);
    if (shot.width !== step.width || shot.height !== step.height) {
      errors.push(`${where}: kích thước ${shot.width}×${shot.height} ≠ manifest ${step.width}×${step.height}`);
    }
    const ns = (list) => list.map((c) => c.n).join(',');
    if (ns(shot.callouts) !== ns(step.callouts)) {
      errors.push(`${where}: chú thích [${ns(shot.callouts)}] ≠ manifest [${ns(step.callouts)}]`);
    } else {
      shot.callouts.forEach((c, i) => {
        const m = step.callouts[i];
        const diff = ['x', 'y', 'w', 'h'].some((k) => Math.abs(c.boxPct[k] - m.boxPct[k]) > EPS);
        if (diff) errors.push(`${where}: khung chú thích #${c.n} lệch manifest`);
      });
    }
    const ink = shot.ink;
    if (!ink || !ink.data || ink.cols * ink.cell < shot.width - ink.cell || ink.rows * ink.cell < shot.height - ink.cell) {
      errors.push(`${where}: thiếu hoặc sai lưới mực`);
    }
    entries.push([key, shot]);
  }
}

const inManifest = new Set(entries.map(([k]) => k));
const extra = Object.keys(shots).filter((k) => !inManifest.has(k));
if (extra.length) console.warn(`Bỏ qua ${extra.length} ảnh có hình học nhưng không có trong manifest: ${extra.join(', ')}`);

if (errors.length) {
  console.error(`KHÔNG ghi ${path.relative(WEB, OUT_TS)} — ${errors.length} lỗi:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const lines = [
  '/**',
  ' * TỰ SINH bởi `apps/web/scripts/dtf-guide/emit-ts.mjs` từ `scripts/dtf-guide/out/guideShots.generated.json`',
  ' * (do `capture.mjs` ghi) — KHÔNG sửa tay; chụp lại rồi chạy lại script. Toạ độ theo % ảnh (DtfRoleGuide.md §6).',
  ' * `file` là đường dẫn trong `public/guide/dtf/`; trang tự nối tiền tố (`dtfGuideRoles.ts`).',
  ' */',
  '',
  "import type { GuideShot } from '../order/guideTypes';",
  '',
  'export const DTF_SHOTS = {',
];
for (const [key, s] of entries) {
  lines.push(`  ${q(key)}: {`);
  lines.push(`    file: ${q(s.file)},`);
  lines.push(`    width: ${s.width},`);
  lines.push(`    height: ${s.height},`);
  lines.push('    callouts: [');
  for (const c of s.callouts) {
    const b = c.boxPct;
    lines.push(`      { n: ${c.n}, xPct: ${c.xPct}, yPct: ${c.yPct}, boxPct: { x: ${b.x}, y: ${b.y}, w: ${b.w}, h: ${b.h} } },`);
  }
  lines.push('    ],');
  lines.push('    ink: {');
  lines.push(`      cell: ${s.ink.cell},`);
  lines.push(`      cols: ${s.ink.cols},`);
  lines.push(`      rows: ${s.ink.rows},`);
  lines.push(`      data: ${q(s.ink.data)},`);
  lines.push('    },');
  lines.push('  },');
}
lines.push('} satisfies Record<string, GuideShot>;', '');

fs.mkdirSync(path.dirname(OUT_TS), { recursive: true });
fs.writeFileSync(OUT_TS, lines.join('\n'));
process.stdout.write(`Đã ghi ${path.relative(WEB, OUT_TS)} — ${entries.length} ảnh / ${manifest.length} vai.\n`);
