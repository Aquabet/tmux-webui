#!/usr/bin/env bash
# 从仓库根目录运行: ./scripts/install.sh [--password-stdin] [--systemd]
# 先查前置依赖再装——缺工具链时 npm install 会甩一屏 gyp 报错，
# 提前一句话说清楚比让人去读编译日志强得多。
set -euo pipefail

NODE_MIN=20
TMUX_MIN_MAJOR=2
TMUX_MIN_MINOR=2

password_stdin=false
setup_systemd=false
for arg in "$@"; do
  case "$arg" in
    --password-stdin) password_stdin=true ;;
    --systemd) setup_systemd=true ;;
    -h | --help)
      sed -n '2,4p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $arg" >&2
      exit 1
      ;;
  esac
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

fail() {
  echo "✗ $1" >&2
  exit 1
}

echo "==> 检查前置依赖"

command -v node >/dev/null || fail "未找到 node。需要 Node.js >= ${NODE_MIN}。"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge "$NODE_MIN" ] ||
  fail "Node.js 版本过低: $(node -v)，需要 >= ${NODE_MIN}。"
echo "  node $(node -v)"

command -v tmux >/dev/null ||
  fail "未找到 tmux。安装后重试（apt install tmux / brew install tmux / dnf install tmux）。"
tmux_version="$(tmux -V | sed 's/^tmux //')"
tmux_major="${tmux_version%%.*}"
tmux_minor="${tmux_version#*.}"
tmux_minor="${tmux_minor//[!0-9]/}" # 3.6b -> 6；tmux 的版本号可能带字母后缀
if [ "$tmux_major" -lt "$TMUX_MIN_MAJOR" ] ||
  { [ "$tmux_major" -eq "$TMUX_MIN_MAJOR" ] && [ "${tmux_minor:-0}" -lt "$TMUX_MIN_MINOR" ]; }; then
  fail "tmux 版本过低: ${tmux_version}，需要 >= ${TMUX_MIN_MAJOR}.${TMUX_MIN_MINOR}（用到 set-hook）。"
fi
echo "  tmux ${tmux_version}"

# node-pty 只对 macOS/Windows 提供预编译产物，其余平台必须现场编译
if [ "$(uname -s)" != "Darwin" ]; then
  missing=""
  for tool in python3 make cc; do
    command -v "$tool" >/dev/null || missing="${missing} ${tool}"
  done
  [ -z "$missing" ] || fail "node-pty 需要现场编译，缺少:${missing}
  Debian/Ubuntu: sudo apt install -y build-essential python3
  Fedora/RHEL:   sudo dnf install -y gcc-c++ make python3"
  echo "  编译工具链就绪"
fi

# 用 ci 而非 install：严格按 lockfile 装，且不会改动 lockfile——
# npm install 会顺手改 peer 标志位，把工作区弄脏，之后 update.sh 会拒绝更新
echo "==> 安装依赖"
npm ci
npm --prefix web ci

echo "==> 构建"
npm run build

config_file="${HOME}/.tmux-webui/config.json"
if grep -q TMUX_WEBUI_PASSWORD_HASH "$config_file" 2>/dev/null; then
  echo "==> 已有访问密码，跳过（要改密码运行: node dist/main.js init）"
elif [ "$password_stdin" = true ]; then
  echo "==> 从标准输入读取访问密码"
  node dist/main.js init --password-stdin
else
  echo "==> 设置访问密码"
  node dist/main.js init
fi

if [ "$setup_systemd" = true ]; then
  unit="${HOME}/.config/systemd/user/tmux-webui.service"
  if [ -e "$unit" ]; then
    echo "==> ${unit} 已存在，未改动"
  else
    echo "==> 写入 ${unit}"
    mkdir -p "$(dirname "$unit")"
    # KillMode=process 是必须的：从界面新建 session 时，若 tmux server 尚未运行，
    # 它会作为本服务的子进程被拉起。默认的 control-group 模式会在重启本服务时
    # 把整个 cgroup 杀光，连带干掉用户的 tmux server 和里面所有会话。
    cat >"$unit" <<EOF
[Unit]
Description=tmux-webui
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${repo_root}
Environment=PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin
ExecStart=$(command -v node) ${repo_root}/dist/main.js
Restart=on-failure
RestartSec=5
KillMode=process

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now tmux-webui
    # 没有 linger，退出登录后 user service 会被杀
    loginctl enable-linger "$USER" || echo "  提示: loginctl enable-linger 失败，退出登录后服务会停止"
    echo "  已启动，systemctl --user status tmux-webui 查看状态"
  fi
fi

echo
if [ "$setup_systemd" = true ]; then
  echo "完成。服务已注册开机自启，打开 http://127.0.0.1:8090"
  echo "常用: systemctl --user {status,restart,stop} tmux-webui"
else
  echo "完成。前台启动: node dist/main.js    然后打开 http://127.0.0.1:8090"
  echo "要开机自启（推荐）: ./scripts/install.sh --systemd"
fi
echo "这是网页版 shell，默认只监听本机；远程访问请走 Tailscale 或带 TLS 的反代。"
