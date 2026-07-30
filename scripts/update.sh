#!/usr/bin/env bash
# 从仓库根目录运行: ./scripts/update.sh [--main] [--yes]
# 默认切到最新的 release tag——侧栏的更新提示比的就是 release，
# 更新落到别处会让"提示的版本"和"实际跑的代码"对不上。
# --main 改为跟随 main 分支（会拿到尚未发布的提交）。
set -euo pipefail

track_main=false
assume_yes=false
for arg in "$@"; do
  case "$arg" in
    --main) track_main=true ;;
    --yes | -y) assume_yes=true ;;
    -h | --help)
      sed -n '2,5p' "$0"
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

git rev-parse --git-dir >/dev/null 2>&1 || fail "这里不是 git 仓库，无法自动更新。"

# 有未提交改动就停：更新要 checkout，硬来会覆盖掉别人的本地修改
if [ -n "$(git status --porcelain)" ]; then
  fail "工作区有未提交的改动，先处理掉再更新：
$(git status --short)"
fi

ensure_node_tools() {
  if command -v node >/dev/null && command -v npm >/dev/null; then
    return
  fi

  # WebUI 发起的更新跑在 tmux server 的环境里；tmux 可能早于 NVM 初始化，
  # PATH 里没有 node。运行中的 systemd 服务却知道实际 Node 路径，从 /proc
  # 找回同一套 bin，避免 checkout 完才在 npm 阶段失败。
  local service_pid service_node
  service_pid="$(systemctl --user show tmux-webui.service -p MainPID --value 2>/dev/null || true)"
  if [[ "$service_pid" =~ ^[1-9][0-9]*$ ]]; then
    service_node="$(readlink "/proc/${service_pid}/exe" 2>/dev/null || true)"
    if [ -x "$service_node" ]; then
      PATH="$(dirname "$service_node"):${PATH}"
      export PATH
    fi
  fi

  command -v node >/dev/null ||
    fail "未找到 node。请先让 tmux 的 PATH 包含 Node.js，或重新运行 install.sh --systemd。"
  command -v npm >/dev/null ||
    fail "找到了 node，但同目录没有 npm。请安装完整的 Node.js/npm 后重试。"
}

ensure_node_tools

current_version="$(node -p 'require("./package.json").version' 2>/dev/null || echo 未知)"
echo "==> 当前版本 ${current_version}"

echo "==> 拉取远端"
git fetch --tags --prune origin

if [ "$track_main" = true ]; then
  target="origin/main"
  target_label="main 分支最新提交（可能包含未发布内容）"
else
  target="$(git tag -l --sort=-v:refname | head -1)"
  [ -n "$target" ] || fail "远端没有任何 release tag。跟随 main 请加 --main。"
  target_label="release ${target}"
fi

already_at_target=false
if [ "$(git rev-parse HEAD)" = "$(git rev-parse "$target^{commit}")" ]; then
  already_at_target=true
  echo "==> 代码已是 ${target_label}，仍将重建并重启以修复未完成的上次更新"
else
  echo "==> 将更新到 ${target_label}"
  git --no-pager log --oneline "HEAD..${target}" | head -20
  echo
fi

if [ "$assume_yes" != true ]; then
  # 没有终端时不静默继续：更新会 checkout 代码并重启服务
  [ -t 0 ] || fail "非交互环境请加 --yes 确认。"
  printf '继续？[y/N] '
  read -r answer
  case "$answer" in
    y | Y) ;;
    *)
      echo "已取消，未改动。"
      exit 0
      ;;
  esac
fi

if [ "$already_at_target" != true ]; then
  git checkout --quiet "$target"
fi

echo "==> 安装依赖"
npm ci
npm --prefix web ci

echo "==> 构建"
npm run build

new_version="$(node -p 'require("./package.json").version' 2>/dev/null || echo 未知)"

# 只重启指向本目录的那个服务：仓库可能被 clone 了多份，
# 光看 unit 存不存在就重启，会打断跑着另一份代码的实例
unit_exec="$(systemctl --user show tmux-webui.service -p ExecStart --value 2>/dev/null || true)"
case "$unit_exec" in
  '')
    echo "==> 未检测到 systemd 服务，请自行重启进程"
    ;;
  *"${repo_root}/"*)
    echo "==> 重启服务"
    systemctl --user restart tmux-webui
    systemctl --user is-active tmux-webui.service >/dev/null &&
      echo "  tmux-webui 运行中"
    ;;
  *)
    echo "==> tmux-webui 服务指向的是别的目录，未重启；本目录的进程请自行重启"
    ;;
esac

echo
echo "完成：${current_version} -> ${new_version}"
