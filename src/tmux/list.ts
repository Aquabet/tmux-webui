import type { TmuxExec } from './exec.js'

export const VIEW_PREFIX = 'webui-'

export interface TmuxWindow {
  index: number
  name: string
  active: boolean
}

export interface TmuxSession {
  name: string
  attached: boolean
  windows: TmuxWindow[]
}

export function parseSessions(sessionsOut: string, windowsOut: string): TmuxSession[] {
  const windowsBySession = new Map<string, TmuxWindow[]>()
  for (const line of windowsOut.split('\n').filter(Boolean)) {
    const [session, index, name, active] = line.split('\t')
    const existing = windowsBySession.get(session) ?? []
    windowsBySession.set(session, [
      ...existing,
      { index: Number(index), name, active: active === '1' },
    ])
  }
  return sessionsOut
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, attached] = line.split('\t')
      return { name, attached: attached === '1', windows: windowsBySession.get(name) ?? [] }
    })
    .filter((s) => !s.name.startsWith(VIEW_PREFIX))
}

export async function listSessions(exec: TmuxExec): Promise<TmuxSession[]> {
  const sessionsOut = await exec([
    'list-sessions',
    '-F',
    '#{session_name}\t#{?session_attached,1,0}',
  ])
  const windowsOut = await exec([
    'list-windows',
    '-a',
    '-F',
    '#{session_name}\t#{window_index}\t#{window_name}\t#{?window_active,1,0}',
  ])
  return parseSessions(sessionsOut, windowsOut)
}
