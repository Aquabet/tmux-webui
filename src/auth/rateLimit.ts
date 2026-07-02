export interface RateLimiter {
  allow(key: string): boolean
}

export function createRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const hits = new Map<string, number[]>()
  return {
    allow(key) {
      const t = now()
      const recent = (hits.get(key) ?? []).filter((h) => t - h < windowMs)
      if (recent.length >= max) {
        hits.set(key, recent)
        return false
      }
      hits.set(key, [...recent, t])
      return true
    },
  }
}
