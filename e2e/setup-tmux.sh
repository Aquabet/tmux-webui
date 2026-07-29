#!/usr/bin/env bash
# 为 E2E 准备独立 tmux server（不触碰用户默认 server）
set -euo pipefail
SOCKET=webui-e2e

# kill-server 后立即复用同一个 socket 会与旧 server 退出竞态。已有 server 时
# 先用临时 session 保活，再重建 demo，避免测试重跑偶发 "server exited unexpectedly"。
if tmux -L "$SOCKET" list-sessions >/dev/null 2>&1; then
  reset_session=tmux-webui-e2e-reset
  tmux -L "$SOCKET" new-session -Ad -s "$reset_session"
  tmux -L "$SOCKET" kill-session -t demo 2>/dev/null || true
  tmux -L "$SOCKET" new-session -d -s demo -n first
  tmux -L "$SOCKET" kill-session -t "$reset_session"
else
  tmux -L "$SOCKET" new-session -d -s demo -n first
fi

tmux -L "$SOCKET" new-window -t demo -n second
echo "e2e tmux server ready (socket: $SOCKET)"
