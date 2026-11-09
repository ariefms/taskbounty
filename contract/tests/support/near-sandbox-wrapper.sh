#!/bin/bash
# near-sandbox-wrapper.sh — launches the real near-sandbox binary with the
# nofile-shim preloaded (see README.md in this dir).
# Point NEAR_SANDBOX_BIN_PATH at this script so near-workspaces uses it
# (both at build time — it skips the S3 download — and at test runtime).
HERE="$(cd "$(dirname "$0")" && pwd)"
REAL_BIN="$HOME/.near/near-sandbox-2.14.0/near-sandbox"
export LD_PRELOAD="$HERE/nofile-shim.so${LD_PRELOAD:+:$LD_PRELOAD}"
exec "$REAL_BIN" "$@"
