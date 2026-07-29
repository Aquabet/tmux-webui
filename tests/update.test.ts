import { describe, expect, it, vi } from 'vitest'
import { compareVersions, createUpdateChecker } from '../src/update.js'

describe('compareVersions', () => {
  it('按数值比较而不是字典序', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })

  it('容忍 v 前缀与位数缺失', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('v2', '1.9.9')).toBe(1)
  })

  it('容忍 pi 前缀（本项目的 tag 前缀，带不带连字符都认）', () => {
    expect(compareVersions('pi3.1.0', '3.1.0')).toBe(0)
    expect(compareVersions('pi-3.1.0', '3.1.0')).toBe(0)
    expect(compareVersions('pi3.14.0', 'pi3.1.0')).toBe(1)
  })

  it('π 展开的版本按数值比较：3.14 高于 3.1，3.141 高于 3.14', () => {
    expect(compareVersions('3.14.0', '3.1.0')).toBe(1)
    expect(compareVersions('3.141.0', '3.14.0')).toBe(1)
    expect(compareVersions('3.1415.0', '3.141.0')).toBe(1)
    expect(compareVersions('3.1.2', '3.1.10')).toBe(-1)
  })

  it('预发布版本排在同号正式版之前', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.1', '0.9.0')).toBe(1)
  })
})

function releaseResponse(tag: string): Response {
  return {
    ok: true,
    json: async () => ({ tag_name: tag, html_url: `https://example.test/${tag}` }),
  } as unknown as Response
}

describe('createUpdateChecker', () => {
  it('有新版本时报告可更新与发布页链接', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(releaseResponse('v0.2.0'))
    const check = createUpdateChecker({ current: '0.1.0', enabled: true, fetchImpl })
    expect(await check()).toEqual({
      current: '0.1.0',
      latest: '0.2.0',
      url: 'https://example.test/v0.2.0',
      updateAvailable: true,
    })
  })

  it('本地版本不低于最新时不报可更新', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(releaseResponse('v0.1.0'))
    const check = createUpdateChecker({ current: '0.2.0', enabled: true, fetchImpl })
    expect((await check()).updateAvailable).toBe(false)
  })

  it('关闭检查时完全不发网络请求', async () => {
    const fetchImpl = vi.fn()
    const check = createUpdateChecker({ current: '0.1.0', enabled: false, fetchImpl })
    expect(await check()).toEqual({
      current: '0.1.0',
      latest: null,
      url: null,
      updateAvailable: false,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('缓存成功结果，TTL 内不重复请求', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(releaseResponse('v0.2.0'))
    let now = 1000
    const check = createUpdateChecker({
      current: '0.1.0',
      enabled: true,
      fetchImpl,
      ttlMs: 10_000,
      now: () => now,
    })
    await check()
    await check()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    now += 10_001
    await check()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('并发调用只发一次请求', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(releaseResponse('v0.2.0'))
    const check = createUpdateChecker({ current: '0.1.0', enabled: true, fetchImpl })
    await Promise.all([check(), check(), check()])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('网络失败时降级为未知，不抛错', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const check = createUpdateChecker({ current: '0.1.0', enabled: true, fetchImpl })
    expect(await check()).toEqual({
      current: '0.1.0',
      latest: null,
      url: null,
      updateAvailable: false,
    })
  })

  it('失败结果的缓存比成功短，恢复后能重试', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('offline'))
    let now = 1000
    const check = createUpdateChecker({
      current: '0.1.0',
      enabled: true,
      fetchImpl,
      ttlMs: 10_000,
      failureTtlMs: 1_000,
      now: () => now,
    })
    await check()
    now += 1_001
    fetchImpl.mockResolvedValue(releaseResponse('v0.2.0'))
    expect((await check()).latest).toBe('0.2.0')
  })

  it('接口返回非 2xx 时按未知处理', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response)
    const check = createUpdateChecker({ current: '0.1.0', enabled: true, fetchImpl })
    expect((await check()).latest).toBeNull()
  })
})
