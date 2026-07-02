#!/usr/bin/env bash
# 为 E2E 准备独立 tmux server（不触碰用户默认 server）
set -euo pipefail
SOCKET=webui-e2e
tmux -L "$SOCKET" kill-server 2>/dev/null || true
tmux -L "$SOCKET" new-session -d -s demo -n first
tmux -L "$SOCKET" new-window -t demo -n second
echo "e2e tmux server ready (socket: $SOCKET)"
