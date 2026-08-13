import { describe, expect, it } from 'vitest'
import { createPlanUsageService } from '../../src/planUsage/service.js'
import type { ProviderUsage, UsageProvider } from '../../src/planUsage/types.js'

function stubProvider(
  id: string,
  collect?: () => Promise<ProviderUsage>,
): { provider: UsageProvider; calls: () => number } {
  let calls = 0
  const provider: UsageProvider = {
    id,
    displayName: id,
    collect: async () => {
      calls++
      if (collect) return collect()
      return { providerId: id, displayName: id, status: 'ok', windows: [] }
    },
  }
  return { provider, calls: () => calls }
}

describe('createPlanUsageService', () => {
  it('只采集 enabled 列表里的 provider，未启用的完全不调用', async () => {
    const a = stubProvider('a')
    const b = stubProvider('b')
    const service = createPlanUsageService({
      providers: [a.provider, b.provider],
      enabled: ['a'],
      now: () => 1000,
    })
    const report = await service.collect()
    expect(report.providers.map((p) => p.providerId)).toEqual(['a'])
    expect(a.calls()).toBe(1)
    expect(b.calls()).toBe(0)
  })

  it('enabled 里的未知 id 被忽略', async () => {
    const a = stubProvider('a')
    const service = createPlanUsageService({
      providers: [a.provider],
      enabled: ['a', 'nope'],
      now: () => 1000,
    })
    const report = await service.collect()
    expect(report.providers.map((p) => p.providerId)).toEqual(['a'])
  })

  it('报告带 schemaVersion 和 collectedAt', async () => {
    const a = stubProvider('a')
    const service = createPlanUsageService({
      providers: [a.provider],
      enabled: ['a'],
      now: () => 12345,
    })
    const report = await service.collect()
    expect(report.schemaVersion).toBe(1)
    expect(report.collectedAt).toBe(12345)
  })

  it('缓存期内不重复采集，过期后重新采集', async () => {
    let time = 0
    const a = stubProvider('a')
    const service = createPlanUsageService({
      providers: [a.provider],
      enabled: ['a'],
      cacheMs: 60_000,
      now: () => time,
    })
    await service.collect()
    time = 30_000
    await service.collect()
    expect(a.calls()).toBe(1)
    time = 60_001
    await service.collect()
    expect(a.calls()).toBe(2)
  })

  it('并发调用合并为一次采集', async () => {
    let resolve!: (usage: ProviderUsage) => void
    const pending = new Promise<ProviderUsage>((r) => {
      resolve = r
    })
    const a = stubProvider('a', () => pending)
    const service = createPlanUsageService({
      providers: [a.provider],
      enabled: ['a'],
      now: () => 1000,
    })
    const first = service.collect()
    const second = service.collect()
    resolve({ providerId: 'a', displayName: 'a', status: 'ok', windows: [] })
    await Promise.all([first, second])
    expect(a.calls()).toBe(1)
  })

  it('单个 provider 抛错时其余不受影响，错误不外泄', async () => {
    const bad = stubProvider('bad', () => Promise.reject(new Error('secret path /home/x')))
    const good = stubProvider('good')
    const service = createPlanUsageService({
      providers: [bad.provider, good.provider],
      enabled: ['bad', 'good'],
      now: () => 1000,
    })
    const report = await service.collect()
    const badUsage = report.providers.find((p) => p.providerId === 'bad')
    expect(badUsage?.status).toBe('error')
    expect(JSON.stringify(report)).not.toContain('secret path')
    expect(report.providers.find((p) => p.providerId === 'good')?.status).toBe('ok')
  })
})
