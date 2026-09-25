#!/usr/bin/env bash
# Dựng một worktree cho agent phụ: nhánh riêng tách từ dev, chép file .env
# (bị gitignore nên worktree không tự có), cài gói, build shared + core.
#
# Chạy:  bash tao-worktree.sh <tên>        # ví dụ: bash tao-worktree.sh a1
set -euo pipefail

TEN="${1:?Cách dùng: bash tao-worktree.sh <tên>}"
GOC=/root/.vibedev/repos/onos
DICH="/root/.vibedev/repos/onos-$TEN"
NHANH="agent/$TEN"

[ -e "$DICH" ] && { echo "Đã có $DICH — bỏ qua."; exit 0; }

cd "$GOC"
git worktree add "$DICH" -b "$NHANH" dev

# .env nằm ngoài git nên phải chép tay, nếu không API/Web không khởi động được.
cd "$GOC" && find . -name '.env*' -not -path '*/node_modules/*' -not -name '*.example' \
  -exec cp --parents {} "$DICH/" \;

# Token registry riêng của Zalo — thiếu là pnpm install chết ở 401.
set -a; . /root/.onos-ghcr.env; set +a
cd "$DICH"
pnpm install --frozen-lockfile
pnpm --filter shared build && pnpm --filter core build

echo "✓ $DICH sẵn sàng (nhánh $NHANH)"
