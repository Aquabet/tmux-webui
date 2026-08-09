import { z } from 'zod'
import type { TmuxExec } from './exec.js'
import { descendantCommands, listProcesses, type ProcessList } from './processes.js'

export const VIEW_PREFIX = 'webui-'
const AGENT_KINDS = ['codex', 'claude', 'pi', 'kimi', 'opencode'] as const
const agentKindSchema = z.enum(AGENT_KINDS)
const rawAgentStatusSchema = z.enum(['running', 'idle', 'waiting'])
const SHELL_COMMANDS = new Set(['bash', 'csh', 'dash', 'fish', 'ksh', 'sh', 'tcsh', 'zsh'])
const observedCodexActivity = new Set<string>()

type AgentKind = z.infer<typeof agentKindSchema>
type AgentStatus = 'running' | 'waiting'
type PaneAgentStatus = AgentStatus | 'idle'

interface TmuxAgent {
  kind: AgentKind
  status?: AgentStatus
}

interface TmuxWindow {
  index: number
  name: string
  active: boolean
}

interface TmuxSession {
  name: string
  attached: boolean
  windows: TmuxWindow[]
  agents?: TmuxAgent[]
}

interface PaneAgent {
  session: string
  pane: string
  kind: AgentKind
  status?: PaneAgentStatus
}

function kindFromCommand(command: string): AgentKind | undefined {
  const base = command.toLowerCase().split('/').at(-1) ?? ''
  if (base === 'codex' || base.startsWith('codex-')) return 'codex'
  if (base === 'claude' || base.startsWith('claude-')) return 'claude'
  if (base === 'pi') return 'pi'
  if (base === 'kimi' || base === 'kimi-code' || base === 'kimi-cli') return 'kimi'
  if (base === 'opencode' || base.startsWith('opencode-')) return 'opencode'
  return undefined
}

function normalizeStatus(status: z.infer<typeof rawAgentStatusSchema>): PaneAgentStatus {
  return status
}

function statusFromTitle(
  kind: AgentKind,
  pane: string,
  title: string,
  codexActivitySeen: Set<string>,
): PaneAgentStatus | undefined {
  if (kind !== 'codex' && kind !== 'claude') return undefined
  // Codex 与 Claude Code 的默认 title 都用 Braille spinner 表示当前仍在执行。
  // 只在已由进程确认是对应 agent 后使用，避免把普通 shell 的标题当状态。
  if (/^[\u2800-\u28ff](?:\s|$)/u.test(title.trim())) {
    if (kind === 'codex') codexActivitySeen.add(pane)
    return 'running'
  }
  if (kind === 'codex' && /\bAction Required\b/i.test(title)) {
    codexActivitySeen.add(pane)
    return 'waiting'
  }
  // 静态标题只说明当前没有活动；除非明确出现交互提示，正常结束不能冒充等待回应。
  if (title.trim() !== '' || codexActivitySeen.has(pane)) return 'idle'
  return undefined
}

function parsePaneAgents(
  panesOut: string,
  processesOut: string,
  codexActivitySeen: Set<string>,
): PaneAgent[] {
  const agents = panesOut
    .split('\n')
    .filter(Boolean)
    .flatMap((line): PaneAgent[] => {
      const [
        session,
        pane,
        command,
        rawHookKind,
        rawStatus,
        rawPanePid,
        paneTitle = '',
        rawCodexStatus,
        rawClaudeStatus,
        rawPiStatus,
        rawKimiStatus,
        rawOpenCodeStatus,
      ] = line.split('\t')
      const hookKind = agentKindSchema.safeParse(rawHookKind)
      const commandKind = kindFromCommand(command)
      const descendantKind = descendantCommands(processesOut, Number(rawPanePid))
        .map(kindFromCommand)
        .find((kind) => kind !== undefined)

      // agent 异常退出时 pane option 可能来不及清；shell 已回到前台就是更强的新证据。
      const commandBase = command.toLowerCase().split('/').at(-1) ?? ''
      if (SHELL_COMMANDS.has(commandBase) && !descendantKind) return []
      const kind = commandKind ?? descendantKind ?? (hookKind.success ? hookKind.data : undefined)
      if (!kind) return []

      const scopedStatuses: Record<AgentKind, string | undefined> = {
        codex: rawCodexStatus,
        claude: rawClaudeStatus,
        pi: rawPiStatus,
        kimi: rawKimiStatus,
        opencode: rawOpenCodeStatus,
      }
      const parsedScopedStatus = rawAgentStatusSchema.safeParse(scopedStatuses[kind])
      const parsedStatus = rawAgentStatusSchema.safeParse(rawStatus)
      const statusMatchesKind = !hookKind.success || hookKind.data === kind
      const titleStatus = statusFromTitle(kind, pane, paneTitle, codexActivitySeen)
      const hookStatus = parsedScopedStatus.success
        ? normalizeStatus(parsedScopedStatus.data)
        : parsedStatus.success && statusMatchesKind
          ? normalizeStatus(parsedStatus.data)
          : undefined
      // hook 是 agent 主动上报的精确信号；标题只在 hook 缺失时兜底。
      // Codex 的 Action Required 是标题解析出的显式 waiting，因此仍可立即覆盖旧 hook。
      const status = titleStatus === 'waiting' ? 'waiting' : (hookStatus ?? titleStatus)
      return [
        {
          session,
          pane,
          kind,
          ...(status ? { status } : {}),
        },
      ]
    })
  const activeCodexPanes = new Set(
    agents.filter((agent) => agent.kind === 'codex').map((agent) => agent.pane),
  )
  for (const pane of codexActivitySeen) {
    if (!activeCodexPanes.has(pane)) codexActivitySeen.delete(pane)
  }
  return agents
}

function agentsBySession(
  panesOut: string,
  processesOut: string,
  codexActivitySeen: Set<string>,
): Map<string, TmuxAgent[]> {
  const panesBySession = new Map<string, Map<AgentKind, PaneAgent[]>>()
  for (const pane of parsePaneAgents(panesOut, processesOut, codexActivitySeen)) {
    const byKind = panesBySession.get(pane.session) ?? new Map<AgentKind, PaneAgent[]>()
    const panes = byKind.get(pane.kind) ?? []
    byKind.set(pane.kind, [...panes, pane])
    panesBySession.set(pane.session, byKind)
  }

  return new Map(
    [...panesBySession].map(([session, byKind]) => [
      session,
      [...byKind]
        .sort(([a], [b]) => AGENT_KINDS.indexOf(a) - AGENT_KINDS.indexOf(b))
        .map(([kind, panes]) => {
          const status = panes.some((pane) => pane.status === 'running')
            ? 'running'
            : panes.some((pane) => pane.status === 'waiting')
              ? 'waiting'
              : undefined
          return { kind, ...(status ? { status } : {}) }
        }),
    ]),
  )
}

export function parseSessions(
  sessionsOut: string,
  windowsOut: string,
  panesOut = '',
  processesOut = '',
  codexActivitySeen = new Set<string>(),
): TmuxSession[] {
  const rawSessions = sessionsOut
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, attached, rawGroup] = line.split('\t')
      return { name, attached: attached === '1', group: rawGroup || name }
    })
  const attachedGroups = new Set(
    rawSessions.filter((session) => session.attached).map((session) => session.group),
  )
  const windowsBySession = new Map<string, TmuxWindow[]>()
  const agentMap = agentsBySession(panesOut, processesOut, codexActivitySeen)
  for (const line of windowsOut.split('\n').filter(Boolean)) {
    const [session, index, name, active] = line.split('\t')
    const existing = windowsBySession.get(session) ?? []
    windowsBySession.set(session, [
      ...existing,
      { index: Number(index), name, active: active === '1' },
    ])
  }
  return rawSessions
    .map(({ name, group }) => {
      const agents = agentMap.get(name)
      return {
        name,
        // WebUI 连接的是同组的临时 view；组内任一 session attached 都代表
        // 这组窗口当前有活跃前台。
        attached: attachedGroups.has(group),
        windows: windowsBySession.get(name) ?? [],
        ...(agents?.length ? { agents } : {}),
      }
    })
    .filter((s) => !s.name.startsWith(VIEW_PREFIX))
}

export async function listSessions(
  exec: TmuxExec,
  getProcesses: ProcessList = listProcesses,
): Promise<TmuxSession[]> {
  const sessionsOut = await exec([
    'list-sessions',
    '-F',
    '#{session_name}\t#{?session_attached,1,0}\t#{session_group}',
  ])
  const windowsOut = await exec([
    'list-windows',
    '-a',
    '-F',
    '#{session_name}\t#{window_index}\t#{window_name}\t#{?window_active,1,0}',
  ])
  const panesOut = await exec([
    'list-panes',
    '-a',
    '-F',
    '#{session_name}\t#{pane_id}\t#{pane_current_command}\t#{@tmux_webui_agent}\t#{@tmux_webui_status}\t#{pane_pid}\t#{pane_title}\t#{@tmux_webui_status_codex}\t#{@tmux_webui_status_claude}\t#{@tmux_webui_status_pi}\t#{@tmux_webui_status_kimi}\t#{@tmux_webui_status_opencode}',
  ])
  // ps 只是为了识别 wrapper 内的 agent；不可用时仍保留 tmux 原生识别路径。
  const processesOut = await getProcesses().catch(() => '')
  return parseSessions(sessionsOut, windowsOut, panesOut, processesOut, observedCodexActivity)
}
