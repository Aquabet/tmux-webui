import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// 全局配置文件：npx 场景下没有项目目录，.env 的「相对启动目录」定位不适用。
// 键名与环境变量一致，省掉一层映射，文档也只需维护一份名字表。
export const CONFIG_DIR = path.join(homedir(), '.tmux-webui')
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export function parseConfigJson(content: string): Record<string, string> {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch (err) {
    throw new Error(`配置文件不是合法 JSON: ${err instanceof Error ? err.message : err}`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('配置文件顶层必须是 JSON 对象')
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'object') {
      throw new Error(`配置项 ${key} 必须是字符串/数字/布尔值`)
    }
    out[key] = String(value)
  }
  return out
}

// 不存在按「未配置」处理；存在但内容坏掉要报错——静默忽略自己写过的配置最难查
export function loadConfigFile(file: string): Record<string, string> {
  let content: string
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  return parseConfigJson(content)
}

// 含密码哈希，权限收到 0600；已存在的文件 writeFileSync 的 mode 不生效，显式 chmod
export function writeConfigFile(file: string, values: Record<string, string>): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600)
}
