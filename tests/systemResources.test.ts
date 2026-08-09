import { describe, expect, it, vi } from 'vitest'
import {
  createSystemResourceSampler,
  parseAvailableMemory,
  type CpuTimes,
} from '../src/systemResources.js'

describe('system resources', () => {
  it('从 /proc/meminfo 读取可用内存并换算成字节', () => {
    expect(parseAvailableMemory('MemTotal: 8192 kB\nMemAvailable: 2048 kB\n')).toBe(2 * 1024 * 1024)
    expect(parseAvailableMemory('MemTotal: 8192 kB\n')).toBeUndefined()
  })

  it('按两次 CPU 累计时间的差值计算占用率，并缓存短时间内的重复请求', () => {
    const samples: CpuTimes[][] = [
      [{ user: 300, nice: 0, sys: 200, idle: 500, irq: 0 }],
      [{ user: 350, nice: 10, sys: 220, idle: 520, irq: 0 }],
      [{ user: 380, nice: 10, sys: 240, idle: 570, irq: 0 }],
    ]
    const cpuTimes = vi.fn(() => samples.shift() ?? [])
    let now = 10_000
    const sample = createSystemResourceSampler({
      cpuTimes,
      totalMemory: () => 1_000,
      availableMemory: () => 250,
      now: () => now,
      cacheMs: 1_000,
    })

    expect(sample()).toEqual({
      cpuPercent: 80,
      cpuCount: 1,
      memoryUsedBytes: 750,
      memoryTotalBytes: 1_000,
      memoryPercent: 75,
    })
    expect(sample().cpuPercent).toBe(80)
    expect(cpuTimes).toHaveBeenCalledTimes(2)

    now += 1_001
    expect(sample().cpuPercent).toBe(50)
    expect(cpuTimes).toHaveBeenCalledTimes(3)
  })

  it('异常或零差值不会产生 NaN、负数或超过 100 的百分比', () => {
    const cpuTimes = vi
      .fn<() => CpuTimes[]>()
      .mockReturnValueOnce([{ user: 1, nice: 0, sys: 0, idle: 1, irq: 0 }])
      .mockReturnValue([{ user: 1, nice: 0, sys: 0, idle: 1, irq: 0 }])
    const sample = createSystemResourceSampler({
      cpuTimes,
      totalMemory: () => 0,
      availableMemory: () => -1,
      cacheMs: 0,
    })

    expect(sample()).toEqual({
      cpuPercent: 0,
      cpuCount: 1,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      memoryPercent: 0,
    })
  })

  it('把倒退的 CPU 计数和越界内存值限制在有效范围内', () => {
    const cpuTimes = vi
      .fn<() => CpuTimes[]>()
      .mockReturnValueOnce([{ user: 10, nice: 0, sys: 0, idle: 10, irq: 0 }])
      .mockReturnValueOnce([{ user: 20, nice: 0, sys: 0, idle: 5, irq: 0 }])
      .mockReturnValue([{ user: 20, nice: 0, sys: 0, idle: 30, irq: 0 }])
    const sample = createSystemResourceSampler({
      cpuTimes,
      totalMemory: () => 1_000,
      availableMemory: () => 2_000,
      cacheMs: 0,
    })

    expect(sample()).toMatchObject({
      cpuPercent: 100,
      memoryUsedBytes: 0,
      memoryPercent: 0,
    })
    expect(sample().cpuPercent).toBe(0)
  })
})
