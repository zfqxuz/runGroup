#!/bin/bash
# 真实浏览器 E2E：加载 .env、设置本地 Playwright 浏览器路径后运行。
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
. ./.env
set +a

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/home/zfq/runGroup/.pw-browsers}"
export LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-/home/zfq/runGroup/.pw-deps/rootfs/usr/lib/x86_64-linux-gnu}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:3100}"

exec npx playwright test "$@"
