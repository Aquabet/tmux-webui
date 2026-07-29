import { execFile } from 'node:child_process'

export type ProcessList = () => Promise<string>

interface ProcessInfo {
  pid: number
  parentPid: number
  command: string
}

function parseProcesses(output: string): ProcessInfo[] {
  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
      if (!match) return []
      return [{ pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] }]
    })
}

export function descendantCommands(output: string, rootPid: number): string[] {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return []
  const children = new Map<number, ProcessInfo[]>()
  for (const process of parseProcesses(output)) {
    const siblings = children.get(process.parentPid) ?? []
    siblings.push(process)
    children.set(process.parentPid, siblings)
  }

  const commands: string[] = []
  const queue = [...(children.get(rootPid) ?? [])]
  const visited = new Set<number>()
  while (queue.length > 0) {
    const process = queue.shift()
    if (!process || visited.has(process.pid)) continue
    visited.add(process.pid)
    commands.push(process.command)
    queue.push(...(children.get(process.pid) ?? []))
  }
  return commands
}

export const listProcesses: ProcessList = () =>
  new Promise((resolve, reject) => {
    execFile('ps', ['-Ao', 'pid=,ppid=,comm='], { timeout: 3000 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
