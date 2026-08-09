import { readFileSync } from 'node:fs'
import { cpus, freemem, platform, totalmem } from 'node:os'

export interface CpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

export interface SystemResources {
  cpuPercent: number
  cpuCount: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  memoryPercent: number
}

interface SamplerOptions {
  cpuTimes?: () => CpuTimes[]
  totalMemory?: () => number
  availableMemory?: () => number
  now?: () => number
  cacheMs?: number
}

interface CpuSnapshot {
  total: number
  idle: number
  count: number
}

const DEFAULT_CACHE_MS = 1_000

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10
}

function snapshotCpu(times: CpuTimes[]): CpuSnapshot {
  return times.reduce<CpuSnapshot>(
    (sum, cpu) => ({
      total: sum.total + cpu.user + cpu.nice + cpu.sys + cpu.idle + cpu.irq,
      idle: sum.idle + cpu.idle,
      count: sum.count + 1,
    }),
    { total: 0, idle: 0, count: 0 },
  )
}

export function parseAvailableMemory(meminfo: string): number | undefined {
  const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)
  if (!match) return undefined
  return Number.parseInt(match[1], 10) * 1024
}

function systemAvailableMemory(): number {
  // Linux 的 free 只算完全空闲页，会把随时可回收的文件缓存也计作“已用”；
  // MemAvailable 更接近 top/free 呈现给用户的实际可用内存。
  if (platform() === 'linux') {
    try {
      const available = parseAvailableMemory(readFileSync('/proc/meminfo', 'utf8'))
      if (available !== undefined) return available
    } catch {
      // 容器可能没有 /proc；退回 Node 的跨平台值。
    }
  }
  return freemem()
}

export function createSystemResourceSampler(options: SamplerOptions = {}): () => SystemResources {
  const cpuTimes = options.cpuTimes ?? (() => cpus().map((cpu) => cpu.times satisfies CpuTimes))
  const totalMemory = options.totalMemory ?? totalmem
  const availableMemory = options.availableMemory ?? systemAvailableMemory
  const now = options.now ?? Date.now
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS
  let previousCpu = snapshotCpu(cpuTimes())
  let cached: { value: SystemResources; until: number } | undefined

  return function sample(): SystemResources {
    const timestamp = now()
    if (cached && timestamp < cached.until) return cached.value

    const currentCpu = snapshotCpu(cpuTimes())
    const totalDelta = currentCpu.total - previousCpu.total
    const idleDelta = currentCpu.idle - previousCpu.idle
    previousCpu = currentCpu
    const cpuPercent =
      totalDelta > 0 ? clampPercent(((totalDelta - Math.max(0, idleDelta)) / totalDelta) * 100) : 0

    const memoryTotalBytes = Math.max(0, totalMemory())
    const available = Math.min(memoryTotalBytes, Math.max(0, availableMemory()))
    const memoryUsedBytes = Math.max(0, memoryTotalBytes - available)
    const memoryPercent =
      memoryTotalBytes > 0 ? clampPercent((memoryUsedBytes / memoryTotalBytes) * 100) : 0

    const value = {
      cpuPercent,
      cpuCount: currentCpu.count,
      memoryUsedBytes,
      memoryTotalBytes,
      memoryPercent,
    }
    cached = { value, until: timestamp + cacheMs }
    return value
  }
}
