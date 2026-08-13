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

// 配额百分比变化慢，quota provider 又会打上游接口——Anthropic 的 usage
// 端点对每分钟一次的轮询都会 429，所以采集间隔放宽到 5 分钟
const DEFAULT_CACHE_MS = 5 * 60_000

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
  // 上游接口的瞬时故障（限流、超时）不应该把界面打成「获取失败」：
  // 出错时回退到该 provider 上一次成功的结果，窗口里的 observedAt
  // 保持旧值，展示端因此仍然如实
  const lastGood = new Map<string, ProviderUsage>()

  async function refresh(collectedAt: number): Promise<PlanUsageReport> {
    const usages = await Promise.all(
      providers.map(async (provider): Promise<ProviderUsage> => {
        let usage: ProviderUsage
        try {
          usage = await provider.collect()
        } catch (error) {
          // 失败细节只留在服务端日志；响应里不带路径或错误消息
          console.error(`采集 ${provider.id} 用量失败:`, error)
          usage = {
            providerId: provider.id,
            displayName: provider.displayName,
            status: 'error',
            windows: [],
          }
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
