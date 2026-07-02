export interface RateLimiter {
  allow(key: string): boolean
  size(): number
}

export function createRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const hits = new Map<string, number[]>()
  let lastSweep = now()

  const sweep = (t: number) => {
    if (t - lastSweep < windowMs) return
    lastSweep = t

    const keysToDelete: string[] = []
    for (const [key, timestamps] of hits) {
      if (timestamps.every((h) => t - h >= windowMs)) {
        keysToDelete.push(key)
      }
    }
    for (const key of keysToDelete) {
      hits.delete(key)
    }
  }

  return {
    allow(key) {
      const t = now()
      sweep(t)
      const recent = (hits.get(key) ?? []).filter((h) => t - h < windowMs)
      if (recent.length >= max) {
        hits.set(key, recent)
        return false
      }
      hits.set(key, [...recent, t])
      return true
    },
    size() {
      return hits.size
    },
  }
}
