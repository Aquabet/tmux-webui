#!/usr/bin/env bash
# 从仓库根目录运行: ./scripts/update.sh [--main] [--yes]
# 默认切到最新的 release tag——侧栏的更新提示比的就是 release，
# 更新落到别处会让"提示的版本"和"实际跑的代码"对不上。
# --main 改为跟随 main 分支（会拿到尚未发布的提交）。
set -euo pipefail

NODE_MIN=20
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
  local node_major=""
  # WebUI 发起的更新跑在 tmux server 的环境里；tmux 可能早于 NVM 初始化，
  # 或指向另一套受支持的 Node。始终优先使用服务进程的同一套 bin，避免 node-pty
  # 用 Node A 的 ABI 编译后再由 Node B 启动。
  local service_pid service_node service_bin
  service_pid="$(systemctl --user show tmux-webui.service -p MainPID --value 2>/dev/null || true)"
  if [[ "$service_pid" =~ ^[1-9][0-9]*$ ]]; then
    service_node="$(readlink "/proc/${service_pid}/exe" 2>/dev/null || true)"
    if [ -x "$service_node" ]; then
      service_bin="$(dirname "$service_node")"
      if [ -x "${service_bin}/npm" ]; then
        PATH="${service_bin}:${PATH}"
        export PATH
      fi
    fi
  fi

  if command -v node >/dev/null && command -v npm >/dev/null; then
    node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
    if [[ "$node_major" =~ ^[0-9]+$ ]] && [ "$node_major" -ge "$NODE_MIN" ]; then
      return
    fi
  fi

  command -v node >/dev/null ||
    fail "未找到 node。请先让 tmux 的 PATH 包含 Node.js，或重新运行 install.sh --systemd。"
  command -v npm >/dev/null ||
    fail "找到了 node，但同目录没有 npm。请安装完整的 Node.js/npm 后重试。"
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
  [[ "$node_major" =~ ^[0-9]+$ ]] && [ "$node_major" -ge "$NODE_MIN" ] ||
    fail "Node.js 版本过低或无法识别，需要 >= ${NODE_MIN}。"
}

ensure_node_tools

current_version="$(node -p 'require("./package.json").version' 2>/dev/null || echo 未知)"
echo "==> 当前版本 ${current_version}"

# 自动模式必须能重启当前目录的服务，否则“更新成功”只代表磁盘文件变了，
# 浏览器实际连接的后端仍是旧进程。交互式 CLI 允许构建后由用户亲自重启。
restart_service=false
unit_exec="$(systemctl --user show tmux-webui.service -p ExecStart --value 2>/dev/null || true)"
case "$unit_exec" in
  *"${repo_root}/"*)
    restart_service=true
    ;;
  '')
    [ "$assume_yes" != true ] ||
      fail "未检测到指向本目录的 systemd 服务，无法自动重启；请运行 install.sh --systemd 后重试。"
    echo "==> 未检测到 systemd 服务；构建后必须自行重启进程"
    ;;
  *)
    [ "$assume_yes" != true ] ||
      fail "tmux-webui 服务指向别的目录，无法自动重启本目录；请检查 systemd unit。"
    echo "==> tmux-webui 服务指向别的目录；构建后必须自行重启本目录进程"
    ;;
esac

echo "==> 拉取远端"
release_namespace="refs/tmux-webui-update/tags"
git fetch --prune origin \
  '+refs/heads/*:refs/remotes/origin/*' \
  "+refs/tags/*:${release_namespace}/*"

if [ "$track_main" = true ]; then
  target="origin/main"
  target_label="main 分支最新提交（可能包含未发布内容）"
else
  target=""
  target_tag=""
  while IFS= read -r candidate_ref; do
    candidate_tag="${candidate_ref#"${release_namespace}/"}"
    if [[ "$candidate_tag" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      target="$candidate_ref"
      target_tag="$candidate_tag"
      break
    fi
  done < <(git for-each-ref --sort=-version:refname --format='%(refname)' "$release_namespace")
  [ -n "$target" ] || fail "远端没有稳定版 release tag。跟随 main 请加 --main。"
  target_label="release ${target_tag}"
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

if [ "$restart_service" = true ]; then
  echo "==> 重启服务"
  systemctl --user restart tmux-webui

  # Type=simple 的 restart 成功只说明进程已拉起，应用仍可能立即崩溃。
  # 连续三次 active 才报完成，也覆盖 RestartSec 引起的短暂重启状态。
  stable_checks=0
  for _attempt in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if systemctl --user is-active tmux-webui.service >/dev/null; then
      stable_checks=$((stable_checks + 1))
      [ "$stable_checks" -ge 3 ] && break
    else
      stable_checks=0
    fi
  done
  [ "$stable_checks" -ge 3 ] ||
    fail "tmux-webui 重启后未能稳定运行，请查看 systemctl --user status tmux-webui。"
  echo "  tmux-webui 已连续确认运行中"
fi

echo
if [ "$restart_service" = true ]; then
  echo "完成：${current_version} -> ${new_version}"
else
  echo "构建完成：${current_version} -> ${new_version}；尚未重启，当前进程仍是旧版本。"
fi
