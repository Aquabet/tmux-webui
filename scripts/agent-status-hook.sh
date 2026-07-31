#!/usr/bin/env bash
# Coding agent lifecycle hook：状态只写进当前 pane，不读取终端内容或 transcript。
# tmux 3.0 才有 pane options；旧版静默跳过，不能让可选 badge 影响 agent 本身。
set -u

provider="${1:-}"
status="${2:-}"

case "$provider" in
  codex | claude | pi | kimi | opencode) ;;
  *)
    echo "agent provider 必须是 codex、claude、pi、kimi 或 opencode" >&2
    exit 2
    ;;
esac

case "$status" in
  running | waiting | idle | clear) ;;
  *)
    echo "agent status 必须是 running、waiting、idle 或 clear" >&2
    exit 2
    ;;
esac

resolve_pane_from_parent() {
  local pane_rows process_id parent_id pane_id pane_pid

  pane_rows="$(tmux list-panes -a -F '#{pane_id} #{pane_pid}' 2>/dev/null)" || return 1
  process_id="$PPID"

  # Claude Code 的 hook 子进程可能不保留 TMUX_PANE；离当前 hook 最近的 pane 根进程才是目标。
  while [[ "$process_id" =~ ^[0-9]+$ ]] && [ "$process_id" -gt 1 ]; do
    while read -r pane_id pane_pid; do
      if [ "$pane_pid" = "$process_id" ] && [[ "$pane_id" =~ ^%[0-9]+$ ]]; then
        printf '%s\n' "$pane_id"
        return 0
      fi
    done <<< "$pane_rows"

    parent_id="$(ps -o ppid= -p "$process_id" 2>/dev/null)" || return 1
    parent_id="${parent_id//[[:space:]]/}"
    [ "$parent_id" = "$process_id" ] && return 1
    process_id="$parent_id"
  done

  return 1
}

agent_from_command() {
  local command
  command="$(printf '%s' "${1##*/}" | tr '[:upper:]' '[:lower:]')"
  case "$command" in
    codex | codex-*) printf '%s\n' codex ;;
    claude | claude-*) printf '%s\n' claude ;;
    pi) printf '%s\n' pi ;;
    kimi | kimi-code | kimi-cli) printf '%s\n' kimi ;;
    opencode | opencode-*) printf '%s\n' opencode ;;
    *) return 1 ;;
  esac
}

outer_agent_from_parent() {
  local target_pane="$1" pane_pid process_id parent_id command agent outer_agent=""

  pane_pid="$(tmux display-message -p -t "$target_pane" '#{pane_pid}' 2>/dev/null)" ||
    return 1
  pane_pid="${pane_pid//[[:space:]]/}"
  [[ "$pane_pid" =~ ^[0-9]+$ ]] || return 1
  process_id="$PPID"

  # 从 hook 向 pane 根进程回溯，最后遇到的 agent 是真正占用这个 pane 的外层 agent。
  while [[ "$process_id" =~ ^[0-9]+$ ]] && [ "$process_id" -gt 1 ]; do
    command="$(ps -o comm= -p "$process_id" 2>/dev/null)" || return 1
    agent="$(agent_from_command "$command")" || agent=""
    [ -n "$agent" ] && outer_agent="$agent"
    [ "$process_id" = "$pane_pid" ] && break

    parent_id="$(ps -o ppid= -p "$process_id" 2>/dev/null)" || return 1
    parent_id="${parent_id//[[:space:]]/}"
    [ "$parent_id" = "$process_id" ] && return 1
    process_id="$parent_id"
  done

  [ "$process_id" = "$pane_pid" ] || return 1
  [ -n "$outer_agent" ] && printf '%s\n' "$outer_agent"
  return 0
}

pane="${TMUX_PANE:-}"
if [ -z "$pane" ]; then
  # hook 在 tmux 外运行也属于正常场景；不要给 agent 制造一条错误提示。
  [ -z "${TMUX:-}" ] && exit 0
  pane="$(resolve_pane_from_parent)" || exit 0
fi

[[ "$pane" =~ ^%[0-9]+$ ]] || {
  echo "非法 TMUX_PANE: $pane" >&2
  exit 2
}

# Claude 等 agent 可以在自己的 pane 里启动另一个 agent。内层 hook 不能覆盖外层状态。
outer_agent="$(outer_agent_from_parent "$pane")" || outer_agent=""
[ -n "$outer_agent" ] && [ "$outer_agent" != "$provider" ] && exit 0

status_option="@tmux_webui_status_${provider}"
if [ "$status" = clear ]; then
  tmux set-option -p -q -u -t "$pane" "$status_option" 2>/dev/null || exit 0
  tmux set-option -p -q -u -t "$pane" @tmux_webui_agent 2>/dev/null || exit 0
  tmux set-option -p -q -u -t "$pane" @tmux_webui_status 2>/dev/null || true
  exit 0
fi

tmux set-option -p -q -t "$pane" "$status_option" "$status" 2>/dev/null || exit 0
tmux set-option -p -q -t "$pane" @tmux_webui_agent "$provider" 2>/dev/null || exit 0
tmux set-option -p -q -t "$pane" @tmux_webui_status "$status" 2>/dev/null || true
