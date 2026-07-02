import { readFileSync } from 'node:fs'

export function parseEnvFile(content: string): Record<string, string> {
  const entries = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .flatMap((line): Array<readonly [string, string]> => {
      const eq = line.indexOf('=')
      if (eq <= 0) return []
      const key = line.slice(0, eq).trim()
      const raw = line.slice(eq + 1).trim()
      const isQuoted =
        raw.length >= 2 &&
        ((raw.startsWith("'") && raw.endsWith("'")) ||
          (raw.startsWith('"') && raw.endsWith('"')))
      const value = isQuoted ? raw.slice(1, -1) : raw
      return [[key, value]]
    })
  return Object.fromEntries(entries)
}

export function loadEnvFile(path: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(path, 'utf8'))
  } catch {
    // .env 是可选文件，不存在或不可读时按无配置处理
    return {}
  }
}
