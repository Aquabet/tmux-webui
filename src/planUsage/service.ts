import {
  PLAN_USAGE_SCHEMA_VERSION,
  type PlanUsageReport,
  type ProviderUsage,
  type UsageProvider,
} from './types.js'

// provider 注册是静态的：加新 provider = 新模块 + registry 数组加一行。
// 绝不做运行时动态加载——这个服务等于网页版 shell，代码面必须可审计。
//
// 启用哪些 provider 由界面里的开关决定（enabledStore 落盘）。未启用的
// provider 连 collect 都不会被调用，即服务不会去读它的数据目录或凭据，
// 但仍会以 status: 'disabled' 出现在报告里，好让设置面板列出可选项。

const DEFAULT_CACHE_MS = 5 * 60_000

interface ServiceOptions {
  providers: UsageProvider[]
  /** 数组或取值函数；用函数可以让开关改动立刻生效 */
  enabled: string[] | (() => string[])
  cacheMs?: number
  now?: () => number
}

interface PlanUsageService {
  collect(): Promise<PlanUsageReport>
}

export function createPlanUsageService(options: ServiceOptions): PlanUsageService {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS
  const now = options.now ?? Date.now
  const readEnabled = () =>
    new Set(typeof options.enabled === 'function' ? options.enabled() : options.enabled)

  let cached: { report: PlanUsageReport; until: number; key: string } | undefined
  let inFlight: { promise: Promise<PlanUsageReport>; key: string } | undefined
  // 上游接口的瞬时故障（限流、超时）不应该把界面打成「获取失败」：
  // 出错时回退到该 provider 上一次成功的结果，窗口里的 observedAt
  // 保持旧值，展示端因此仍然如实
  const lastGood = new Map<string, ProviderUsage>()

  async function refresh(collectedAt: number, enabled: Set<string>): Promise<PlanUsageReport> {
    const usages = await Promise.all(
      options.providers.map(async (provider): Promise<ProviderUsage> => {
        const base = { providerId: provider.id, displayName: provider.displayName }
        if (!enabled.has(provider.id)) {
          return { ...base, status: 'disabled', windows: [] }
        }
        let usage: ProviderUsage
        try {
          usage = await provider.collect()
        } catch (error) {
          // 失败细节只留在服务端日志；响应里不带路径或错误消息
          console.error(`采集 ${provider.id} 用量失败:`, error)
          usage = { ...base, status: 'error', windows: [] }
        }
        if (usage.status === 'ok') {
          lastGood.set(provider.id, usage)
          return usage
        }
        if (usage.status === 'error') {
          return lastGood.get(provider.id) ?? usage
        }
        return usage
      }),
    )
    return { schemaVersion: PLAN_USAGE_SCHEMA_VERSION, collectedAt, providers: usages }
  }

  return {
    async collect(): Promise<PlanUsageReport> {
      const timestamp = now()
      const enabled = readEnabled()
      // 启用集合变了就作废缓存，否则改完开关还要等几分钟才看到数字
      const key = [...enabled].sort().join(',')
      if (cached && cached.key === key && timestamp < cached.until) return cached.report
      if (inFlight && inFlight.key === key) return inFlight.promise
      const promise = refresh(timestamp, enabled)
        .then((report) => {
          cached = { report, until: timestamp + cacheMs, key }
          return report
        })
        .finally(() => {
          if (inFlight?.promise === promise) inFlight = undefined
        })
      inFlight = { promise, key }
      return promise
    },
  }
}
