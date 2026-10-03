#!/usr/bin/env bash
# Replace the OnosPod credentials in an API env file and restart the API.
#
# The legacy OnosPod JWT carries the account password inside its payload, so a
# password change invalidates every stored token at once and the gateway then
# answers "Your account had been banned" on every call -- which looks like a
# vendor ban but is not one. One token feeds all three variables: both
# app.onospod.com and qc.onospod.com accept the same value.
#
#   ./fix-onospod-token.sh <token> [env-file]
#
# env-file defaults to apps/api/.env (production). Pass
# apps/api/.env.development to patch the dev box instead.
#
# The token is never printed, never logged and never written outside the env
# file. Pass it as the argument; do not edit it into this file, which is
# tracked by git.

set -euo pipefail

REPO_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$REPO_DIR"

TOKEN=${1:-}
ENV_FILE=${2:-apps/api/.env}
VARS=(ONOSPOD_API_BEARER_TOKEN ONOSPOD_API_SUPER_TOKEN ONOSPOD_QC_BEARER_TOKEN)

die() { echo "✗ $*" >&2; exit 1; }

[ -n "$TOKEN" ] || die "Thiếu token.  Dùng: ./fix-onospod-token.sh <token> [env-file]"
[ -f "$ENV_FILE" ] || die "Không thấy file env: $ENV_FILE"

# Clean the pasted value before checking its shape. A long token wraps in the
# terminal and bash then keeps the newline inside the argument, so whitespace
# has to go through tr (sed works line by line and would leave it in place).
# Strip the whitespace first, which turns "Bearer <tok>" into "Bearer<tok>".
TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]' | sed -E "s/^[Bb]earer//; s/^[\"']//; s/[\"']\$//")
printf '%s' "$TOKEN" | grep -Eq '^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' \
  || die "Token không đúng dạng JWT (phải có 3 phần ngăn bằng dấu chấm)."

ACCOUNT=$(printf '%s' "$TOKEN" | python3 -c '
import base64, json, sys
part = sys.stdin.read().split(".")[1]
part += "=" * (-len(part) % 4)
print(json.loads(base64.urlsafe_b64decode(part)).get("email", "?"))
') || die "Không giải mã được phần giữa của token."
echo "→ Token của tài khoản: $ACCOUNT"

# ── 1. Kiểm tra token TRƯỚC khi sửa file ────────────────────────────────────
# Read-only probe, no side effects. The gateway returns 403 without an Origin
# header no matter how good the token is, so send one for each host.
probe() {
  local host=$1 url=$2 body
  body=$(curl -s -m 20 -X POST "$url" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-onos-super-token: $TOKEN" \
    -H 'Content-Type: application/json' \
    -H "Origin: https://$host" -H "Referer: https://$host/" \
    -d '{"query":"query { __typename }"}' || true)
  case "$body" in
    *'"__typename"'*) echo "   ✓ $host" ;;
    *banned*)         die "$host từ chối token (\"banned\") — token này vẫn là token CŨ. Lấy lại cookie _token sau khi đã đăng nhập bằng mật khẩu mới." ;;
    '')               die "$host không trả lời — kiểm tra mạng của server." ;;
    *)                die "$host trả lỗi lạ: $(printf '%s' "$body" | head -c 200)" ;;
  esac
}
echo "→ Thử token với hệ cũ (chỉ đọc, không ghi gì)..."
probe app.onospod.com https://api.onospod.com/graphql
probe qc.onospod.com  https://qc.onospod.com/graphql

# ── 2. Sao lưu rồi thay ─────────────────────────────────────────────────────
BACKUP="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
echo "→ Đã sao lưu: $BACKUP"

for key in "${VARS[@]}"; do
  grep -q "^$key=" "$ENV_FILE" || die "Trong $ENV_FILE không có dòng $key= — dừng, chưa sửa gì ngoài bản sao lưu."
done

# One sed per key: alternation inside the pattern would clash with the
# delimiter. The token is base64url (no slash, no ampersand) so it is safe on
# the replacement side of s|...|...|.
for key in "${VARS[@]}"; do
  sed -i "s|^$key=.*|$key=$TOKEN|" "$ENV_FILE"
done

for key in "${VARS[@]}"; do
  grep -q "^$key=$TOKEN$" "$ENV_FILE" || die "Thay $key thất bại. Khôi phục: cp $BACKUP $ENV_FILE"
done
echo "→ Đã cập nhật 3 biến trong $ENV_FILE"

# ── 3. Khởi động lại API ────────────────────────────────────────────────────
PORT=$(grep -E '^PORT=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '[:space:]')
PORT=${PORT:-3007}

if command -v pm2 >/dev/null 2>&1 && pm2 pid onosfactory-api >/dev/null 2>&1; then
  echo "→ Khởi động lại API qua PM2..."
  (cd apps/api && NODE_ENV=production pm2 restart ecosystem.config.cjs --update-env >/dev/null && pm2 save >/dev/null)
  RESTART_CMD='pm2 restart onosfactory-api --update-env'
elif systemctl is-active --quiet onos-api-dev 2>/dev/null; then
  echo "→ Khởi động lại API dev (systemd)..."
  systemctl restart onos-api-dev
  RESTART_CMD='systemctl restart onos-api-dev'
else
  die "Không thấy PM2 lẫn service dev. Đã sửa env rồi — anh tự khởi động lại API."
fi

echo "→ Chờ API lên ở cổng $PORT..."
for _ in $(seq 1 40); do
  curl -sf -m 3 "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 && break
  (printf '' >"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1 && break
  sleep 3
done
(printf '' >"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1 \
  || die "API chưa lên sau 2 phút. Xem log: pm2 logs onosfactory-api --err --lines 50"

# ── 4. Kiểm tra token đã chạy qua đúng code của API ─────────────────────────
# This cron is the one that reads design + address back from OnosPod for held
# orders. Running it once is ordinary scheduled work, and it is the only
# endpoint that proves the API itself (not just curl) can reach OnosPod.
echo "→ Gọi thử đường lấy ngược design/địa chỉ..."
RESULT=$(curl -s -m 180 "http://127.0.0.1:$PORT/api/v1/orders/recover-held-from-onospod/cron" || true)
case "$RESULT" in
  *'"success":true'*) echo "   ✓ $RESULT" ;;
  *banned*)           die "API vẫn báo banned — nó chưa nạp env mới. Thử: $RESTART_CMD" ;;
  *)                  die "Kết quả bất thường: $(printf '%s' "$RESULT" | head -c 300)" ;;
esac

echo
echo "✓ XONG. Cầu nối OnosPod đã nối lại."
echo "  Muốn kéo đơn ngay, không cần đợi cron:"
echo "    curl -s \"http://127.0.0.1:$PORT/api/v1/orders/import-from-onospod/cron\""
echo "  Quay lại bản cũ nếu cần:  cp $BACKUP $ENV_FILE && $RESTART_CMD"
