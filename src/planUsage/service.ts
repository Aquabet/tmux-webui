import {
  PLAN_USAGE_SCHEMA_VERSION,
  type PlanUsageReport,
  type ProviderUsage,
  type UsageProvider,
} from './types.js'

// provider 注册是静态的：加新 provider = 新模块 + registry 数组加一行。
// 绝不做运行时动态加载——这个服务等于网页版 shell，代码面必须可审计。
//
// enabled 是服务端 allowlist（来自配置，默认空 = 功能关闭）。
// 未启用的 provider 连 collect 都不会被调用，即服务不会去读它的数据目录。

const DEFAULT_CACHE_MS = 60_000

interface ServiceOptions {
  providers: UsageProvider[]
  enabled: string[]
  cacheMs?: number
  now?: () => number
}

interface PlanUsageService {
  collect(): Promise<PlanUsageReport>
}

export function createPlanUsageService(options: ServiceOptions): PlanUsageService {
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS
  const now = options.now ?? Date.now
  const enabled = new Set(options.enabled)
  const providers = options.providers.filter((provider) => enabled.has(provider.id))

  let cached: { report: PlanUsageReport; until: number } | undefined
  let inFlight: Promise<PlanUsageReport> | undefined

  async function refresh(collectedAt: number): Promise<PlanUsageReport> {
    const usages = await Promise.all(
      providers.map(
        (provider): Promise<ProviderUsage> =>
          provider.collect().catch(
            // 失败细节只留在服务端日志；响应里不带路径或错误消息
            (error) => {
              console.error(`采集 ${provider.id} 用量失败:`, error)
              return {
                providerId: provider.id,
                displayName: provider.displayName,
                status: 'error',
                windows: [],
              }
            },
          ),
      ),
    )
    return { schemaVersion: PLAN_USAGE_SCHEMA_VERSION, collectedAt, providers: usages }
  }

  return {
    async collect(): Promise<PlanUsageReport> {
      const timestamp = now()
      if (cached && timestamp < cached.until) return cached.report
      if (inFlight) return inFlight
      inFlight = refresh(timestamp)
        .then((report) => {
          cached = { report, until: timestamp + cacheMs }
          return report
        })
        .finally(() => {
          inFlight = undefined
        })
      return inFlight
    },
  }
}
