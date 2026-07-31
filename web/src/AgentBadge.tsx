import type { ApiAgent, ApiAgentKind } from './api'

const LABELS = {
  codex: 'Codex',
  claude: 'Claude Code',
  pi: 'Pi',
  kimi: 'Kimi Code',
  opencode: 'OpenCode',
} as const

const STATUS_LABELS = {
  running: '运行中',
  waiting: '等待用户输入',
  unknown: '状态未知',
} as const

function CodexIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 3.8h7.6l4.1 7.2-4.1 7.2H8.2L4.1 11z" />
      <path d="m10.1 8.2-2.6 2.9 2.6 2.8m3.8-5.7 2.6 2.9-2.6 2.8" />
    </svg>
  )
}

function ClaudeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8v18.4M2.8 12h18.4M5.5 5.5l13 13m0-13-13 13" />
    </svg>
  )
}

function PiIcon() {
  return (
    <svg
      className="agent-logo-fill"
      viewBox="0 0 800 800"
      data-logo="official"
      aria-hidden="true"
    >
      {/* Pi 官方 press kit 的 compact badge；方块轮廓在 15px 下仍然清楚。 */}
      <path
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  )
}

function KimiIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.7 16.8A8 8 0 1 1 15.3 4a6.4 6.4 0 0 0 2.4 12.8Z" />
      <path d="m16.7 6.3.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5Z" />
    </svg>
  )
}

function OpenCodeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8.5 6-4 6 4 6m7-12 4 6-4 6M14 4l-4 16" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3m5 0h5" />
    </svg>
  )
}

function AgentIcon({ kind }: { kind: ApiAgentKind }) {
  if (kind === 'codex') return <CodexIcon />
  if (kind === 'claude') return <ClaudeIcon />
  if (kind === 'pi') return <PiIcon />
  if (kind === 'kimi') return <KimiIcon />
  return <OpenCodeIcon />
}

function foregroundLabel(attached: boolean) {
  return attached ? '有活跃前台' : '无活跃前台'
}

export function TerminalBadge({ attached }: { attached: boolean }) {
  const label = `Terminal：${foregroundLabel(attached)}`
  return (
    <span
      className="agent-badge"
      data-agent="terminal"
      data-attached={attached}
      aria-label={label}
      title={label}
    >
      <TerminalIcon />
    </span>
  )
}

export function AgentBadge({ agent, attached }: { agent: ApiAgent; attached: boolean }) {
  const status = agent.status ?? 'unknown'
  const label = `${LABELS[agent.kind]}：${STATUS_LABELS[status]}；${foregroundLabel(attached)}`
  return (
    <span
      className="agent-badge"
      data-agent={agent.kind}
      data-status={status}
      data-attached={attached}
      aria-label={label}
      title={label}
    >
      <AgentIcon kind={agent.kind} />
      {status !== 'unknown' && <span className="agent-status-dot" />}
    </span>
  )
}
