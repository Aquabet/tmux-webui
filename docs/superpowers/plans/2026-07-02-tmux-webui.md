# tmux-webui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自托管 tmux Web UI —— 浏览器中两级导航（session 侧边栏 + window tabs）查看并切换所有 tmux window，提供完整交互终端，视图与本机客户端完全独立。

**Architecture:** 后端 Node.js（Express + ws + node-pty），每个浏览器终端连接创建一个 tmux 分组会话（`webui-*` 前缀）并在 PTY 中 attach，字节流经 WebSocket 直通前端 xterm.js。密码认证（bcrypt + httpOnly cookie + 登录限速），默认只监听 127.0.0.1，HTTPS 由反代/Tailscale 承担。

**Tech Stack:** Node.js 20+ / TypeScript (ESM, strict) / Express 4 / ws 8 / node-pty 1 / bcryptjs / zod / cookie-parser · 前端 Vite + React 18 + @xterm/xterm · 测试 Vitest + supertest + @testing-library/react + Playwright

## Global Constraints

- Node.js >= 20，tmux >= 3.2；TypeScript `strict: true`，ESM（`module: NodeNext`，相对导入必须带 `.js` 后缀）
- 默认绑定 `127.0.0.1:8090`；环境变量前缀 `TMUX_WEBUI_`；`TMUX_WEBUI_PASSWORD_HASH` 未设置时拒绝启动
- 认证 cookie 名固定为 `webui_token`（httpOnly + sameSite=strict；secure 由 `TMUX_WEBUI_COOKIE_SECURE=true` 开启）
- 分组会话（视图）命名前缀固定为 `webui-`；session/window 列表必须过滤掉该前缀的会话
- WebSocket 帧协议：客户端→服务端首字符 `i`=键盘输入、`r`=resize JSON、`w`=切 window JSON；服务端→客户端为原始终端字节
- API 响应统一 `{ success: boolean, data?, error? }`；用户输入一律 zod 校验
- 所有 tmux 子进程调用默认 5 秒超时；集成测试一律使用独立 socket（`tmux -L`），严禁触碰用户默认 tmux server
- 提交信息用 conventional commits（feat/fix/test/docs/chore），不加任何 AI 署名
- 不可变风格：不改传入对象，返回新对象；单文件 < 400 行

---

### Task 1: 后端项目脚手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/.gitkeep`

**Interfaces:**
- Produces: 可运行的 `npm test`（vitest）与 `npx tsc --noEmit` 环境，后续所有任务依赖

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "tmux-webui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json && npm --prefix web run build",
    "start": "node dist/main.js",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "hash-password": "tsx scripts/hash-password.ts"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cookie-parser": "^1.4.6",
    "express": "^4.19.2",
    "node-pty": "^1.0.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/cookie-parser": "^1.4.7",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "@types/ws": "^8.5.10",
    "supertest": "^7.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: 创建 .gitignore**

```
node_modules/
dist/
web/dist/
web/node_modules/
.env
*.log
test-results/
playwright-report/
```

- [ ] **Step 5: 安装依赖并验证**

Run: `npm install && npx tsc --noEmit && npm test`
Expected: 安装成功；tsc 无错误（src 为空亦可，可放一个空的 `src/main.ts` 占位：`export {}`）；vitest 输出 "no test files found" 但 exit 0（`--passWithNoTests`）

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src
git commit -m "chore: 后端脚手架（TypeScript + vitest）"
```

---

### Task 2: 配置加载 config.ts

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { host: string; port: number; passwordHash: string; socketName?: string; sessionTtlMs: number; cookieSecure: boolean }`
  - `function loadConfig(env: NodeJS.ProcessEnv): Config`（缺 `TMUX_WEBUI_PASSWORD_HASH` 时 throw）

- [ ] **Step 1: 写失败测试**

```ts
// tests/config.test.ts
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('缺少 PASSWORD_HASH 时抛错', () => {
    expect(() => loadConfig({})).toThrow(/TMUX_WEBUI_PASSWORD_HASH/)
  })

  it('只给必填项时返回默认值', () => {
    const c = loadConfig({ TMUX_WEBUI_PASSWORD_HASH: '$2a$10$x' })
    expect(c).toEqual({
      host: '127.0.0.1',
      port: 8090,
      passwordHash: '$2a$10$x',
      socketName: undefined,
      sessionTtlMs: 7 * 24 * 3600 * 1000,
      cookieSecure: false,
    })
  })

  it('读取全部环境变量覆盖', () => {
    const c = loadConfig({
      TMUX_WEBUI_PASSWORD_HASH: 'h',
      TMUX_WEBUI_HOST: '0.0.0.0',
      TMUX_WEBUI_PORT: '9000',
      TMUX_WEBUI_SOCKET: 'testsock',
      TMUX_WEBUI_SESSION_TTL_MS: '1000',
      TMUX_WEBUI_COOKIE_SECURE: 'true',
    })
    expect(c.host).toBe('0.0.0.0')
    expect(c.port).toBe(9000)
    expect(c.socketName).toBe('testsock')
    expect(c.sessionTtlMs).toBe(1000)
    expect(c.cookieSecure).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL —— 找不到模块 `../src/config.js`

- [ ] **Step 3: 实现 src/config.ts**

```ts
export interface Config {
  host: string
  port: number
  passwordHash: string
  socketName?: string
  sessionTtlMs: number
  cookieSecure: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const passwordHash = env.TMUX_WEBUI_PASSWORD_HASH
  if (!passwordHash) {
    throw new Error(
      'TMUX_WEBUI_PASSWORD_HASH 未设置。请运行 `npm run hash-password` 生成后再启动。',
    )
  }
  return {
    host: env.TMUX_WEBUI_HOST ?? '127.0.0.1',
    port: Number(env.TMUX_WEBUI_PORT ?? 8090),
    passwordHash,
    socketName: env.TMUX_WEBUI_SOCKET || undefined,
    sessionTtlMs: Number(env.TMUX_WEBUI_SESSION_TTL_MS ?? 7 * 24 * 3600 * 1000),
    cookieSecure: env.TMUX_WEBUI_COOKIE_SECURE === 'true',
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: 环境变量配置加载"
```

---

### Task 3: tmux 命令执行器 exec.ts

**Files:**
- Create: `src/tmux/exec.ts`
- Test: `tests/tmux/exec.test.ts`

**Interfaces:**
- Produces:
  - `type TmuxExec = (args: string[]) => Promise<string>`
  - `class TmuxError extends Error { code: 'NO_SERVER' | 'FAILED' }`
  - `function createTmuxExec(socketName?: string, timeoutMs?: number): TmuxExec`

- [ ] **Step 1: 写失败测试**（用 `echo`/`false` 假可执行文件测超时与错误分类不可靠，改为测试真实 tmux 的隔离 socket 行为 + 错误分类纯逻辑）

```ts
// tests/tmux/exec.test.ts
import { describe, expect, it } from 'vitest'
import { createTmuxExec, TmuxError } from '../../src/tmux/exec.js'

describe('createTmuxExec', () => {
  it('对不存在的独立 socket 报 NO_SERVER', async () => {
    const exec = createTmuxExec('webui-exec-test-nonexistent')
    await expect(exec(['list-sessions'])).rejects.toSatisfy(
      (e: unknown) => e instanceof TmuxError && e.code === 'NO_SERVER',
    )
  })

  it('正常命令返回 stdout', async () => {
    const exec = createTmuxExec()
    // -V 不需要 server 运行
    const out = await exec(['-V'])
    expect(out).toMatch(/^tmux /)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/tmux/exec.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 src/tmux/exec.ts**

```ts
import { execFile } from 'node:child_process'

export type TmuxExec = (args: string[]) => Promise<string>

export class TmuxError extends Error {
  constructor(
    readonly code: 'NO_SERVER' | 'FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'TmuxError'
  }
}

export function createTmuxExec(socketName?: string, timeoutMs = 5000): TmuxExec {
  const base = socketName ? ['-L', socketName] : []
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('tmux', [...base, ...args], { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        const msg = String(stderr || err.message)
        if (/no server running|error connecting to/i.test(msg)) {
          return reject(new TmuxError('NO_SERVER', 'tmux server 未运行'))
        }
        return reject(new TmuxError('FAILED', msg.trim()))
      })
    })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/tmux/exec.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/tmux/exec.ts tests/tmux/exec.test.ts
git commit -m "feat: tmux 命令执行器（超时 + 错误分类）"
```

---

### Task 4: session/window 列表解析 list.ts

**Files:**
- Create: `src/tmux/list.ts`
- Test: `tests/tmux/list.test.ts`

**Interfaces:**
- Consumes: `TmuxExec`（Task 3）
- Produces:
  - `const VIEW_PREFIX = 'webui-'`
  - `interface TmuxWindow { index: number; name: string; active: boolean }`
  - `interface TmuxSession { name: string; attached: boolean; windows: TmuxWindow[] }`
  - `function parseSessions(sessionsOut: string, windowsOut: string): TmuxSession[]`（纯函数）
  - `function listSessions(exec: TmuxExec): Promise<TmuxSession[]>`

- [ ] **Step 1: 写失败测试**

```ts
// tests/tmux/list.test.ts
import { describe, expect, it } from 'vitest'
import { listSessions, parseSessions } from '../../src/tmux/list.js'
import type { TmuxExec } from '../../src/tmux/exec.js'

const SESSIONS = 'admin\t0\ncds\t1\nwebui-abc123\t1\n'
const WINDOWS = [
  'admin\t0\tclaude\t1',
  'cds\t0\tclaude\t1',
  'cds\t1\tlogs\t0',
  'webui-abc123\t0\tclaude\t1',
].join('\n') + '\n'

describe('parseSessions', () => {
  it('解析 session→windows 树并过滤 webui- 前缀', () => {
    const result = parseSessions(SESSIONS, WINDOWS)
    expect(result).toEqual([
      { name: 'admin', attached: false, windows: [{ index: 0, name: 'claude', active: true }] },
      {
        name: 'cds',
        attached: true,
        windows: [
          { index: 0, name: 'claude', active: true },
          { index: 1, name: 'logs', active: false },
        ],
      },
    ])
  })

  it('空输入返回空数组', () => {
    expect(parseSessions('', '')).toEqual([])
  })
})

describe('listSessions', () => {
  it('用正确的 -F 格式调用 tmux', async () => {
    const calls: string[][] = []
    const exec: TmuxExec = async (args) => {
      calls.push(args)
      return args[0] === 'list-sessions' ? SESSIONS : WINDOWS
    }
    const result = await listSessions(exec)
    expect(result).toHaveLength(2)
    expect(calls[0]).toEqual([
      'list-sessions',
      '-F',
      '#{session_name}\t#{?session_attached,1,0}',
    ])
    expect(calls[1]).toEqual([
      'list-windows',
      '-a',
      '-F',
      '#{session_name}\t#{window_index}\t#{window_name}\t#{?window_active,1,0}',
    ])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/tmux/list.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 src/tmux/list.ts**

```ts
import type { TmuxExec } from './exec.js'

export const VIEW_PREFIX = 'webui-'

export interface TmuxWindow {
  index: number
  name: string
  active: boolean
}

export interface TmuxSession {
  name: string
  attached: boolean
  windows: TmuxWindow[]
}

export function parseSessions(sessionsOut: string, windowsOut: string): TmuxSession[] {
  const windowsBySession = new Map<string, TmuxWindow[]>()
  for (const line of windowsOut.split('\n').filter(Boolean)) {
    const [session, index, name, active] = line.split('\t')
    const existing = windowsBySession.get(session) ?? []
    windowsBySession.set(session, [
      ...existing,
      { index: Number(index), name, active: active === '1' },
    ])
  }
  return sessionsOut
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, attached] = line.split('\t')
      return { name, attached: attached === '1', windows: windowsBySession.get(name) ?? [] }
    })
    .filter((s) => !s.name.startsWith(VIEW_PREFIX))
}

export async function listSessions(exec: TmuxExec): Promise<TmuxSession[]> {
  const sessionsOut = await exec([
    'list-sessions',
    '-F',
    '#{session_name}\t#{?session_attached,1,0}',
  ])
  const windowsOut = await exec([
    'list-windows',
    '-a',
    '-F',
    '#{session_name}\t#{window_index}\t#{window_name}\t#{?window_active,1,0}',
  ])
  return parseSessions(sessionsOut, windowsOut)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/tmux/list.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/tmux/list.ts tests/tmux/list.test.ts
git commit -m "feat: tmux session/window 列表解析"
```

---

### Task 5: 分组会话（视图）生命周期 view.ts

**Files:**
- Create: `src/tmux/view.ts`
- Test: `tests/tmux/view.test.ts`（集成测试，独立 socket）

**Interfaces:**
- Consumes: `TmuxExec`、`createTmuxExec`（Task 3）、`VIEW_PREFIX`（Task 4）
- Produces:
  - `interface View { viewName: string; target: string }`
  - `function createView(exec: TmuxExec, target: string, windowIndex?: number): Promise<View>`
  - `function destroyView(exec: TmuxExec, viewName: string): Promise<void>`
  - `function selectWindow(exec: TmuxExec, viewName: string, windowIndex: number): Promise<void>`
  - `function cleanupOrphanViews(exec: TmuxExec, minAgeSeconds?: number): Promise<void>`

- [ ] **Step 1: 写失败测试**（真实 tmux，独立 socket，afterAll 杀掉整个测试 server）

```ts
// tests/tmux/view.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTmuxExec } from '../../src/tmux/exec.js'
import { createView, destroyView, selectWindow, cleanupOrphanViews } from '../../src/tmux/view.js'

const SOCKET = 'webui-view-test'
const exec = createTmuxExec(SOCKET)

beforeAll(async () => {
  await exec(['new-session', '-d', '-s', 'demo', '-n', 'first'])
  await exec(['new-window', '-t', 'demo', '-n', 'second'])
})

afterAll(async () => {
  await exec(['kill-server']).catch(() => undefined)
})

describe('view lifecycle', () => {
  it('createView 创建 webui- 前缀的分组会话', async () => {
    const view = await createView(exec, 'demo')
    expect(view.viewName).toMatch(/^webui-[0-9a-f]{8}$/)
    expect(view.target).toBe('demo')
    const out = await exec(['list-sessions', '-F', '#{session_name}\t#{session_group}'])
    const line = out.split('\n').find((l) => l.startsWith(view.viewName))
    expect(line).toBeDefined()
    await destroyView(exec, view.viewName)
  })

  it('createView 指定 windowIndex 时视图当前 window 独立于原 session', async () => {
    const view = await createView(exec, 'demo', 1)
    const out = await exec([
      'display-message',
      '-p',
      '-t',
      view.viewName,
      '#{window_index}',
    ])
    expect(out.trim()).toBe('1')
    const orig = await exec(['display-message', '-p', '-t', 'demo', '#{window_index}'])
    expect(orig.trim()).toBe('0')
    await destroyView(exec, view.viewName)
  })

  it('selectWindow 切换视图的当前 window', async () => {
    const view = await createView(exec, 'demo')
    await selectWindow(exec, view.viewName, 1)
    const out = await exec(['display-message', '-p', '-t', view.viewName, '#{window_index}'])
    expect(out.trim()).toBe('1')
    await destroyView(exec, view.viewName)
  })

  it('destroyView 对不存在的视图不抛错', async () => {
    await expect(destroyView(exec, 'webui-deadbeef')).resolves.toBeUndefined()
  })

  it('cleanupOrphanViews 清理无客户端的旧视图，保留新视图', async () => {
    const view = await createView(exec, 'demo')
    await cleanupOrphanViews(exec, 0) // minAgeSeconds=0：全部无主视图都算孤儿
    const out = await exec(['list-sessions', '-F', '#{session_name}'])
    expect(out).not.toContain(view.viewName)
    expect(out).toContain('demo')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/tmux/view.test.ts`
Expected: FAIL —— 找不到模块 `../../src/tmux/view.js`

- [ ] **Step 3: 实现 src/tmux/view.ts**

```ts
import { randomBytes } from 'node:crypto'
import type { TmuxExec } from './exec.js'
import { VIEW_PREFIX } from './list.js'

export interface View {
  viewName: string
  target: string
}

export async function createView(
  exec: TmuxExec,
  target: string,
  windowIndex?: number,
): Promise<View> {
  const viewName = `${VIEW_PREFIX}${randomBytes(4).toString('hex')}`
  await exec(['new-session', '-d', '-t', target, '-s', viewName])
  await exec(['set-option', '-t', viewName, 'destroy-unattached', 'on'])
  if (windowIndex !== undefined) {
    await exec(['select-window', '-t', `${viewName}:${windowIndex}`])
  }
  return { viewName, target }
}

export async function destroyView(exec: TmuxExec, viewName: string): Promise<void> {
  try {
    await exec(['kill-session', '-t', viewName])
  } catch {
    // 视图已被 destroy-unattached 清理，属正常情况
  }
}

export async function selectWindow(
  exec: TmuxExec,
  viewName: string,
  windowIndex: number,
): Promise<void> {
  await exec(['select-window', '-t', `${viewName}:${windowIndex}`])
}

export async function cleanupOrphanViews(exec: TmuxExec, minAgeSeconds = 60): Promise<void> {
  const out = await exec([
    'list-sessions',
    '-F',
    '#{session_name}\t#{?session_attached,1,0}\t#{session_created}',
  ]).catch(() => '')
  const nowSec = Math.floor(Date.now() / 1000)
  const orphans = out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(
      ([name, attached, created]) =>
        name.startsWith(VIEW_PREFIX) &&
        attached === '0' &&
        nowSec - Number(created) >= minAgeSeconds,
    )
  for (const [name] of orphans) {
    await destroyView(exec, name)
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/tmux/view.test.ts`
Expected: PASS（5 个用例）。跑完后验证无残留：`tmux -L webui-view-test list-sessions` 应报 no server running

- [ ] **Step 5: Commit**

```bash
git add src/tmux/view.ts tests/tmux/view.test.ts
git commit -m "feat: 分组会话视图生命周期（创建/销毁/切窗口/孤儿清理）"
```

---

### Task 6: 密码校验 + 哈希生成 CLI

**Files:**
- Create: `src/auth/password.ts`, `scripts/hash-password.ts`
- Test: `tests/auth/password.test.ts`

**Interfaces:**
- Produces:
  - `function verifyPassword(password: string, hash: string): Promise<boolean>`
  - `function hashPassword(password: string): Promise<string>`
  - CLI：`npm run hash-password -- <密码>` 输出 bcrypt 哈希

- [ ] **Step 1: 写失败测试**

```ts
// tests/auth/password.test.ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/auth/password.js'

describe('password', () => {
  it('正确密码校验通过', async () => {
    const hash = await hashPassword('s3cret')
    expect(await verifyPassword('s3cret', hash)).toBe(true)
  })

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('s3cret')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('非法哈希返回 false 而不是抛错', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/auth/password.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 src/auth/password.ts**

```ts
import bcrypt from 'bcryptjs'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: 实现 scripts/hash-password.ts**

```ts
import { hashPassword } from '../src/auth/password.js'

const password = process.argv[2]
if (!password) {
  console.error('用法: npm run hash-password -- <密码>')
  process.exit(1)
}
const hash = await hashPassword(password)
console.log('把下面这行加入环境（注意用单引号包裹）：')
console.log(`export TMUX_WEBUI_PASSWORD_HASH='${hash}'`)
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/auth/password.test.ts && npm run hash-password -- demo123`
Expected: 测试 PASS（3 个用例）；CLI 输出 `export TMUX_WEBUI_PASSWORD_HASH='$2a$10$...'`

- [ ] **Step 6: Commit**

```bash
git add src/auth/password.ts scripts/hash-password.ts tests/auth/password.test.ts
git commit -m "feat: bcrypt 密码校验与哈希生成 CLI"
```

---

### Task 7: 登录会话存储 sessions.ts

**Files:**
- Create: `src/auth/sessions.ts`
- Test: `tests/auth/sessions.test.ts`

**Interfaces:**
- Produces:
  - `interface SessionStore { create(): string; isValid(token: string): boolean; destroy(token: string): void }`
  - `function createSessionStore(ttlMs: number, now?: () => number): SessionStore`

- [ ] **Step 1: 写失败测试**

```ts
// tests/auth/sessions.test.ts
import { describe, expect, it } from 'vitest'
import { createSessionStore } from '../../src/auth/sessions.js'

describe('createSessionStore', () => {
  it('create 返回 64 位 hex token 且 isValid 为 true', () => {
    const store = createSessionStore(1000)
    const token = store.create()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(store.isValid(token)).toBe(true)
  })

  it('未知 token 无效', () => {
    const store = createSessionStore(1000)
    expect(store.isValid('nope')).toBe(false)
  })

  it('过期 token 无效', () => {
    let t = 0
    const store = createSessionStore(1000, () => t)
    const token = store.create()
    t = 1001
    expect(store.isValid(token)).toBe(false)
  })

  it('destroy 后无效', () => {
    const store = createSessionStore(1000)
    const token = store.create()
    store.destroy(token)
    expect(store.isValid(token)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/auth/sessions.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 src/auth/sessions.ts**

```ts
import { randomBytes } from 'node:crypto'

export interface SessionStore {
  create(): string
  isValid(token: string): boolean
  destroy(token: string): void
}

export function createSessionStore(ttlMs: number, now: () => number = Date.now): SessionStore {
  const expiries = new Map<string, number>()
  return {
    create() {
      const token = randomBytes(32).toString('hex')
      expiries.set(token, now() + ttlMs)
      return token
    },
    isValid(token) {
      const expiry = expiries.get(token)
      if (expiry === undefined) return false
      if (expiry <= now()) {
        expiries.delete(token)
        return false
      }
      return true
    },
    destroy(token) {
      expiries.delete(token)
    },
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/auth/sessions.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/auth/sessions.ts tests/auth/sessions.test.ts
git commit -m "feat: 内存登录会话存储（TTL token）"
```

---

### Task 8: 登录限速 rateLimit.ts

**Files:**
- Create: `src/auth/rateLimit.ts`
- Test: `tests/auth/rateLimit.test.ts`

**Interfaces:**
- Produces:
  - `interface RateLimiter { allow(key: string): boolean }`
  - `function createRateLimiter(max: number, windowMs: number, now?: () => number): RateLimiter`

- [ ] **Step 1: 写失败测试**

```ts
// tests/auth/rateLimit.test.ts
import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../../src/auth/rateLimit.js'

describe('createRateLimiter', () => {
  it('窗口内不超过 max 次放行', () => {
    const limiter = createRateLimiter(3, 60_000, () => 0)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
  })

  it('不同 key 互不影响', () => {
    const limiter = createRateLimiter(1, 60_000, () => 0)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('b')).toBe(true)
  })

  it('窗口滑过后恢复放行', () => {
    let t = 0
    const limiter = createRateLimiter(1, 1000, () => t)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
    t = 1001
    expect(limiter.allow('a')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/auth/rateLimit.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 src/auth/rateLimit.ts**

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/auth/rateLimit.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/auth/rateLimit.ts tests/auth/rateLimit.test.ts
git commit -m "feat: 登录接口滑动窗口限速"
```

---

### Task 9: REST API（登录/登出/会话列表）

**Files:**
- Create: `src/http/middleware.ts`, `src/http/api.ts`
- Test: `tests/http/api.test.ts`

**Interfaces:**
- Consumes: `Config`（Task 2）、`TmuxExec`/`TmuxError`（Task 3）、`listSessions`（Task 4）、`verifyPassword`（Task 6）、`SessionStore`（Task 7）、`RateLimiter`（Task 8）
- Produces:
  - `const COOKIE_NAME = 'webui_token'`（定义在 `src/http/middleware.ts`）
  - `function requireAuth(store: SessionStore): RequestHandler`
  - `interface ApiDeps { config: Config; store: SessionStore; limiter: RateLimiter; exec: TmuxExec }`
  - `function createApiRouter(deps: ApiDeps): Router` —— 挂载 `POST /login`、`POST /logout`、`GET /sessions`

- [ ] **Step 1: 写失败测试**

```ts
// tests/http/api.test.ts
import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { hashPassword } from '../../src/auth/password.js'
import { createRateLimiter } from '../../src/auth/rateLimit.js'
import { createSessionStore } from '../../src/auth/sessions.js'
import type { Config } from '../../src/config.js'
import { createApiRouter } from '../../src/http/api.js'
import { TmuxError, type TmuxExec } from '../../src/tmux/exec.js'

const SESSIONS_OUT = 'demo\t1\n'
const WINDOWS_OUT = 'demo\t0\tclaude\t1\n'

async function makeApp(overrides: { exec?: TmuxExec; limiterMax?: number } = {}) {
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    passwordHash: await hashPassword('pw'),
    socketName: undefined,
    sessionTtlMs: 60_000,
    cookieSecure: false,
  }
  const exec: TmuxExec =
    overrides.exec ??
    (async (args) => (args[0] === 'list-sessions' ? SESSIONS_OUT : WINDOWS_OUT))
  const app = express()
  app.use(cookieParser())
  app.use(
    '/api',
    createApiRouter({
      config,
      store: createSessionStore(60_000),
      limiter: createRateLimiter(overrides.limiterMax ?? 100, 60_000),
      exec,
    }),
  )
  return app
}

async function loginAgent(app: express.Express) {
  const agent = request.agent(app)
  await agent.post('/api/login').send({ password: 'pw' }).expect(200)
  return agent
}

describe('POST /api/login', () => {
  it('密码正确返回 200 并设置 httpOnly cookie', async () => {
    const app = await makeApp()
    const res = await request(app).post('/api/login').send({ password: 'pw' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    const cookie = res.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toContain('webui_token=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('密码错误返回 401', async () => {
    const app = await makeApp()
    const res = await request(app).post('/api/login').send({ password: 'wrong' })
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('请求体非法返回 400', async () => {
    const app = await makeApp()
    const res = await request(app).post('/api/login').send({})
    expect(res.status).toBe(400)
  })

  it('超过限速返回 429', async () => {
    const app = await makeApp({ limiterMax: 1 })
    await request(app).post('/api/login').send({ password: 'wrong' })
    const res = await request(app).post('/api/login').send({ password: 'pw' })
    expect(res.status).toBe(429)
  })
})

describe('GET /api/sessions', () => {
  it('未认证返回 401', async () => {
    const app = await makeApp()
    const res = await request(app).get('/api/sessions')
    expect(res.status).toBe(401)
  })

  it('认证后返回 session 树', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    const res = await agent.get('/api/sessions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: [
        {
          name: 'demo',
          attached: true,
          windows: [{ index: 0, name: 'claude', active: true }],
        },
      ],
    })
  })

  it('tmux server 未运行返回 503', async () => {
    const app = await makeApp({
      exec: async () => {
        throw new TmuxError('NO_SERVER', 'tmux server 未运行')
      },
    })
    const agent = await loginAgent(app)
    const res = await agent.get('/api/sessions')
    expect(res.status).toBe(503)
    expect(res.body.error).toContain('tmux')
  })
})

describe('POST /api/logout', () => {
  it('登出后原 cookie 失效', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    await agent.post('/api/logout').expect(200)
    await agent.get('/api/sessions').expect(401)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/http/api.test.ts`
Expected: FAIL —— 找不到模块 `../../src/http/api.js`

- [ ] **Step 3: 实现 src/http/middleware.ts**

```ts
import type { RequestHandler } from 'express'
import type { SessionStore } from '../auth/sessions.js'

export const COOKIE_NAME = 'webui_token'

export function requireAuth(store: SessionStore): RequestHandler {
  return (req, res, next) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME]
    if (!token || !store.isValid(token)) {
      res.status(401).json({ success: false, error: '未登录' })
      return
    }
    next()
  }
}
```

- [ ] **Step 4: 实现 src/http/api.ts**

```ts
import { Router, json } from 'express'
import { z } from 'zod'
import { verifyPassword } from '../auth/password.js'
import type { RateLimiter } from '../auth/rateLimit.js'
import type { SessionStore } from '../auth/sessions.js'
import type { Config } from '../config.js'
import { TmuxError, type TmuxExec } from '../tmux/exec.js'
import { listSessions } from '../tmux/list.js'
import { COOKIE_NAME, requireAuth } from './middleware.js'

export interface ApiDeps {
  config: Config
  store: SessionStore
  limiter: RateLimiter
  exec: TmuxExec
}

const loginSchema = z.object({ password: z.string().min(1).max(200) })

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router()
  router.use(json())

  router.post('/login', async (req, res) => {
    if (!deps.limiter.allow(req.ip ?? 'unknown')) {
      res.status(429).json({ success: false, error: '尝试过于频繁，请稍后再试' })
      return
    }
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ success: false, error: '请求格式错误' })
      return
    }
    const ok = await verifyPassword(parsed.data.password, deps.config.passwordHash)
    if (!ok) {
      res.status(401).json({ success: false, error: '密码错误' })
      return
    }
    const token = deps.store.create()
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: deps.config.cookieSecure,
      maxAge: deps.config.sessionTtlMs,
    })
    res.json({ success: true })
  })

  router.post('/logout', (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME]
    if (token) deps.store.destroy(token)
    res.clearCookie(COOKIE_NAME)
    res.json({ success: true })
  })

  router.get('/sessions', requireAuth(deps.store), async (_req, res) => {
    try {
      const data = await listSessions(deps.exec)
      res.json({ success: true, data })
    } catch (error) {
      if (error instanceof TmuxError && error.code === 'NO_SERVER') {
        res.status(503).json({ success: false, error: 'tmux server 未运行' })
        return
      }
      console.error('获取会话列表失败:', error)
      res.status(500).json({ success: false, error: '获取会话列表失败' })
    }
  })

  return router
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/http/api.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 6: Commit**

```bash
git add src/http tests/http
git commit -m "feat: REST API（登录/登出/会话列表）"
```

---

### Task 10: WebSocket 终端通道 ws/terminal.ts

**Files:**
- Create: `src/ws/terminal.ts`
- Test: `tests/ws/terminal.test.ts`

**Interfaces:**
- Consumes: `SessionStore`（Task 7）、`TmuxExec`（Task 3）、`createView`/`destroyView`/`selectWindow`（Task 5）、`COOKIE_NAME`（Task 9）
- Produces:
  - `interface PtyLike { onData(cb: (d: string) => void): void; onExit(cb: () => void): void; write(d: string): void; resize(cols: number, rows: number): void; kill(): void }`
  - `type SpawnPty = (file: string, args: string[], cols: number, rows: number) => PtyLike`
  - `interface TerminalDeps { exec: TmuxExec; store: SessionStore; spawnPty: SpawnPty; socketName?: string }`
  - `function handleTerminalConnection(ws: WebSocket, req: IncomingMessage, deps: TerminalDeps): Promise<void>`
- 帧协议（Global Constraints）：客户端发 `i<bytes>`（输入）、`r{"cols":80,"rows":24}`（resize）、`w{"index":1}`（切 window）；服务端发原始终端输出文本帧
- 关闭码：4401 未认证、4400 缺参数、4404 目标 session 不存在、4410 pty 退出

- [ ] **Step 1: 写失败测试**（真实 ws server + 注入 fake pty / fake exec）

```ts
// tests/ws/terminal.test.ts
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionStore } from '../../src/auth/sessions.js'
import type { TmuxExec } from '../../src/tmux/exec.js'
import {
  handleTerminalConnection,
  type PtyLike,
  type SpawnPty,
  type TerminalDeps,
} from '../../src/ws/terminal.js'

interface FakePty extends PtyLike {
  written: string[]
  resizes: Array<[number, number]>
  killed: boolean
  emitData(d: string): void
  emitExit(): void
}

function makeFakePty(): FakePty {
  let dataCb: ((d: string) => void) | undefined
  let exitCb: (() => void) | undefined
  const pty: FakePty = {
    written: [],
    resizes: [],
    killed: false,
    onData: (cb) => {
      dataCb = cb
    },
    onExit: (cb) => {
      exitCb = cb
    },
    write: (d) => pty.written.push(d),
    resize: (c, r) => pty.resizes.push([c, r]),
    kill: () => {
      pty.killed = true
    },
    emitData: (d) => dataCb?.(d),
    emitExit: () => exitCb?.(),
  }
  return pty
}

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

async function startServer(deps: TerminalDeps): Promise<number> {
  server = createServer()
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleTerminalConnection(ws, req, deps)
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

function makeDeps(pty: FakePty) {
  const store = createSessionStore(60_000)
  const token = store.create()
  const execCalls: string[][] = []
  const exec: TmuxExec = async (args) => {
    execCalls.push(args)
    return ''
  }
  const spawnPty: SpawnPty = () => pty
  const deps: TerminalDeps = { exec, store, spawnPty }
  return { deps, token, execCalls }
}

function connect(port: number, token: string | undefined, query: string) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?${query}`, {
    headers: token ? { cookie: `webui_token=${token}` } : {},
  })
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.on('close', (code) => resolve(code)))
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
}

const flush = () => new Promise((r) => setTimeout(r, 50))

describe('handleTerminalConnection', () => {
  it('无认证 cookie 时以 4401 关闭', async () => {
    const { deps } = makeDeps(makeFakePty())
    const port = await startServer(deps)
    const code = await waitClose(connect(port, undefined, 'session=demo'))
    expect(code).toBe(4401)
  })

  it('缺 session 参数时以 4400 关闭', async () => {
    const { deps, token } = makeDeps(makeFakePty())
    const port = await startServer(deps)
    const code = await waitClose(connect(port, token, ''))
    expect(code).toBe(4400)
  })

  it('createView 失败时以 4404 关闭', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    deps.exec = async () => {
      throw new Error("can't find session")
    }
    const port = await startServer(deps)
    const code = await waitClose(connect(port, token, 'session=nope'))
    expect(code).toBe(4404)
  })

  it('pty 输出转发到客户端；i 帧写入 pty；r 帧 resize；w 帧调 select-window', async () => {
    const pty = makeFakePty()
    const { deps, token, execCalls } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo&window=1')
    await waitOpen(ws)
    await flush()

    const received: string[] = []
    ws.on('message', (d) => received.push(d.toString()))
    pty.emitData('hello from tmux')
    ws.send('iecho hi\r')
    ws.send('r{"cols":120,"rows":40}')
    ws.send('w{"index":2}')
    await flush()

    expect(received).toEqual(['hello from tmux'])
    expect(pty.written).toEqual(['echo hi\r'])
    expect(pty.resizes).toEqual([[120, 40]])
    const selectCalls = execCalls.filter((c) => c[0] === 'select-window')
    // 一次来自 createView 的 window=1，一次来自 w 帧的 index=2
    expect(selectCalls).toHaveLength(2)
    expect(selectCalls[1][2]).toMatch(/^webui-[0-9a-f]{8}:2$/)
    ws.close()
    await flush()
  })

  it('客户端断开时 kill pty 并销毁视图', async () => {
    const pty = makeFakePty()
    const { deps, token, execCalls } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo')
    await waitOpen(ws)
    await flush()
    ws.close()
    await flush()
    expect(pty.killed).toBe(true)
    expect(execCalls.some((c) => c[0] === 'kill-session')).toBe(true)
  })

  it('pty 退出时以 4410 关闭客户端', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo')
    const closed = waitClose(ws)
    await waitOpen(ws)
    await flush()
    pty.emitExit()
    expect(await closed).toBe(4410)
  })

  it('非法 JSON 控制帧不导致崩溃', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo')
    await waitOpen(ws)
    await flush()
    ws.send('r{bad json')
    ws.send('x未知前缀')
    await flush()
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ws/terminal.test.ts`
Expected: FAIL —— 找不到模块 `../../src/ws/terminal.js`

- [ ] **Step 3: 实现 src/ws/terminal.ts**

```ts
import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../auth/sessions.js'
import { COOKIE_NAME } from '../http/middleware.js'
import type { TmuxExec } from '../tmux/exec.js'
import { createView, destroyView, selectWindow, type View } from '../tmux/view.js'

export interface PtyLike {
  onData(cb: (d: string) => void): void
  onExit(cb: () => void): void
  write(d: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type SpawnPty = (file: string, args: string[], cols: number, rows: number) => PtyLike

export interface TerminalDeps {
  exec: TmuxExec
  store: SessionStore
  spawnPty: SpawnPty
  socketName?: string
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const idx = pair.indexOf('=')
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()]
    }),
  )
}

const resizeSchemaGuard = (v: unknown): v is { cols: number; rows: number } =>
  typeof v === 'object' &&
  v !== null &&
  Number.isInteger((v as { cols: unknown }).cols) &&
  Number.isInteger((v as { rows: unknown }).rows)

const windowSchemaGuard = (v: unknown): v is { index: number } =>
  typeof v === 'object' && v !== null && Number.isInteger((v as { index: unknown }).index)

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export async function handleTerminalConnection(
  ws: WebSocket,
  req: IncomingMessage,
  deps: TerminalDeps,
): Promise<void> {
  const cookies = parseCookies(req.headers.cookie)
  const token = cookies[COOKIE_NAME]
  if (!token || !deps.store.isValid(token)) {
    ws.close(4401, 'unauthorized')
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const target = url.searchParams.get('session')
  if (!target) {
    ws.close(4400, 'missing session')
    return
  }
  const windowParam = url.searchParams.get('window')
  const windowIndex = windowParam === null ? undefined : Number(windowParam)

  let view: View
  try {
    view = await createView(deps.exec, target, windowIndex)
  } catch (error) {
    console.error('创建视图失败:', error)
    ws.close(4404, 'session not found')
    return
  }

  const socketArgs = deps.socketName ? ['-L', deps.socketName] : []
  const pty = deps.spawnPty('tmux', [...socketArgs, 'attach-session', '-t', view.viewName], 80, 24)

  pty.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data)
  })
  pty.onExit(() => {
    ws.close(4410, 'pty exited')
    void destroyView(deps.exec, view.viewName)
  })

  ws.on('message', (raw) => {
    const msg = raw.toString()
    const kind = msg[0]
    const rest = msg.slice(1)
    if (kind === 'i') {
      pty.write(rest)
      return
    }
    if (kind === 'r') {
      const parsed = safeJsonParse(rest)
      if (resizeSchemaGuard(parsed) && parsed.cols > 0 && parsed.rows > 0) {
        pty.resize(parsed.cols, parsed.rows)
      }
      return
    }
    if (kind === 'w') {
      const parsed = safeJsonParse(rest)
      if (windowSchemaGuard(parsed) && parsed.index >= 0) {
        selectWindow(deps.exec, view.viewName, parsed.index).catch((error) =>
          console.error('切换 window 失败:', error),
        )
      }
    }
  })

  ws.on('close', () => {
    pty.kill()
    void destroyView(deps.exec, view.viewName)
  })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/ws/terminal.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/ws tests/ws
git commit -m "feat: WebSocket 终端通道（认证 + PTY 桥接 + 帧协议）"
```

---

### Task 11: 服务器装配 server.ts / main.ts

**Files:**
- Create: `src/pty.ts`, `src/server.ts`, `src/main.ts`（替换 Task 1 的占位 main.ts）
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: 前面全部模块
- Produces:
  - `const spawnNodePty: SpawnPty`（`src/pty.ts`，包装 node-pty）
  - `function createAppServer(config: Config, spawnPty?: SpawnPty): http.Server`（`src/server.ts`）
  - `src/main.ts`：加载配置 → `cleanupOrphanViews` → listen，并每 10 分钟跑一次孤儿清理

- [ ] **Step 1: 写失败测试**

```ts
// tests/server.test.ts
import type { AddressInfo } from 'node:net'
import { describe, expect, it, afterEach } from 'vitest'
import type { Server } from 'node:http'
import { hashPassword } from '../src/auth/password.js'
import type { Config } from '../src/config.js'
import { createAppServer } from '../src/server.js'

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

describe('createAppServer', () => {
  it('启动后 /api/login 可用（装配完整性冒烟测试）', async () => {
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      passwordHash: await hashPassword('pw'),
      socketName: 'webui-server-test-none',
      sessionTtlMs: 60_000,
      cookieSecure: false,
    }
    server = createAppServer(config)
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const res = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  it('非 /ws/terminal 的 upgrade 请求被拒绝', async () => {
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      passwordHash: await hashPassword('pw'),
      socketName: 'webui-server-test-none',
      sessionTtlMs: 60_000,
      cookieSecure: false,
    }
    server = createAppServer(config)
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/other`)
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true))
      ws.on('open', () => resolve(false))
    })
    expect(failed).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL —— 找不到模块 `../src/server.js`

- [ ] **Step 3: 实现 src/pty.ts**

```ts
import { spawn } from 'node-pty'
import type { PtyLike, SpawnPty } from './ws/terminal.js'

export const spawnNodePty: SpawnPty = (file, args, cols, rows): PtyLike => {
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME ?? '/',
    env: process.env as Record<string, string>,
  })
  return {
    onData: (cb) => pty.onData(cb),
    onExit: (cb) => pty.onExit(() => cb()),
    write: (d) => pty.write(d),
    resize: (c, r) => pty.resize(c, r),
    kill: () => pty.kill(),
  }
}
```

- [ ] **Step 4: 实现 src/server.ts**

```ts
import { existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import { WebSocketServer } from 'ws'
import { createRateLimiter } from './auth/rateLimit.js'
import { createSessionStore } from './auth/sessions.js'
import type { Config } from './config.js'
import { createApiRouter } from './http/api.js'
import { spawnNodePty } from './pty.js'
import { createTmuxExec } from './tmux/exec.js'
import { handleTerminalConnection, type SpawnPty } from './ws/terminal.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createAppServer(config: Config, spawnPty: SpawnPty = spawnNodePty): http.Server {
  const exec = createTmuxExec(config.socketName)
  const store = createSessionStore(config.sessionTtlMs)
  const limiter = createRateLimiter(5, 60_000)

  const app = express()
  app.use(cookieParser())
  app.use('/api', createApiRouter({ config, store, limiter, exec }))

  const staticDir = path.resolve(__dirname, '../web/dist')
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir))
    app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')))
  }

  const server = http.createServer(app)
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/terminal')) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleTerminalConnection(ws, req, {
        exec,
        store,
        spawnPty,
        socketName: config.socketName,
      })
    })
  })
  return server
}
```

- [ ] **Step 5: 实现 src/main.ts**

```ts
import { loadConfig } from './config.js'
import { createAppServer } from './server.js'
import { createTmuxExec } from './tmux/exec.js'
import { cleanupOrphanViews } from './tmux/view.js'

const config = loadConfig(process.env)
const exec = createTmuxExec(config.socketName)

await cleanupOrphanViews(exec).catch(() => undefined)
setInterval(() => void cleanupOrphanViews(exec).catch(() => undefined), 10 * 60_000)

const server = createAppServer(config)
server.listen(config.port, config.host, () => {
  console.log(`tmux-webui 已启动: http://${config.host}:${config.port}`)
})
```

- [ ] **Step 6: 运行确认通过 + 全量回归**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS，无类型错误

- [ ] **Step 7: Commit**

```bash
git add src/pty.ts src/server.ts src/main.ts tests/server.test.ts
git commit -m "feat: 服务器装配与启动入口"
```

---

### Task 12: 前端脚手架 + API client + 登录页

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/api.ts`, `web/src/App.tsx`, `web/src/Login.tsx`, `web/src/styles.css`
- Test: `web/src/api.test.ts`

**Interfaces:**
- Consumes: Task 9 的 REST API（`/api/login`、`/api/sessions`，响应 `{ success, data?, error? }`）
- Produces:
  - `interface ApiWindow { index: number; name: string; active: boolean }`
  - `interface ApiSession { name: string; attached: boolean; windows: ApiWindow[] }`
  - `class AuthError extends Error {}`
  - `async function login(password: string): Promise<void>`（失败 throw Error(服务端 error 文案)）
  - `async function fetchSessions(): Promise<ApiSession[]>`（401 时 throw AuthError）
  - `<App />`：authed=false 时渲染 `<Login onSuccess={...} />`

- [ ] **Step 1: 创建 web/package.json**

```json
{
  "name": "tmux-webui-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 创建 web/tsconfig.json、web/vite.config.ts、web/vitest.config.ts、web/index.html**

```json
// web/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

```ts
// web/vite.config.ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8090',
      '/ws': { target: 'ws://127.0.0.1:8090', ws: true },
    },
  },
})
```

```ts
// web/vitest.config.ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

```html
<!-- web/index.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>tmux webui</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: 写失败测试 web/src/api.test.ts**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError, fetchSessions, login } from './api'

afterEach(() => vi.restoreAllMocks())

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

describe('login', () => {
  it('成功时正常返回', async () => {
    mockFetch(200, { success: true })
    await expect(login('pw')).resolves.toBeUndefined()
  })

  it('失败时抛出服务端错误文案', async () => {
    mockFetch(401, { success: false, error: '密码错误' })
    await expect(login('pw')).rejects.toThrow('密码错误')
  })
})

describe('fetchSessions', () => {
  it('返回 data 数组', async () => {
    mockFetch(200, { success: true, data: [{ name: 'demo', attached: true, windows: [] }] })
    await expect(fetchSessions()).resolves.toEqual([
      { name: 'demo', attached: true, windows: [] },
    ])
  })

  it('401 时抛 AuthError', async () => {
    mockFetch(401, { success: false, error: '未登录' })
    await expect(fetchSessions()).rejects.toBeInstanceOf(AuthError)
  })

  it('503 时抛普通 Error（tmux 未运行）', async () => {
    mockFetch(503, { success: false, error: 'tmux server 未运行' })
    await expect(fetchSessions()).rejects.toThrow('tmux server 未运行')
  })
})
```

- [ ] **Step 4: 运行确认失败**

Run: `cd web && npm install && npx vitest run src/api.test.ts`
Expected: FAIL —— 找不到 `./api`

- [ ] **Step 5: 实现 web/src/api.ts**

```ts
export interface ApiWindow {
  index: number
  name: string
  active: boolean
}

export interface ApiSession {
  name: string
  attached: boolean
  windows: ApiWindow[]
}

export class AuthError extends Error {
  constructor() {
    super('未登录')
    this.name = 'AuthError'
  }
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function parseBody<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return (await res.json()) as ApiResponse<T>
  } catch {
    return { success: false, error: `HTTP ${res.status}` }
  }
}

export async function login(password: string): Promise<void> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const body = await parseBody<never>(res)
    throw new Error(body.error ?? '登录失败')
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' })
}

export async function fetchSessions(): Promise<ApiSession[]> {
  const res = await fetch('/api/sessions')
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<ApiSession[]>(res)
  if (!res.ok || !body.success) throw new Error(body.error ?? '获取会话列表失败')
  return body.data ?? []
}
```

- [ ] **Step 6: 运行确认通过**

Run: `cd web && npx vitest run src/api.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 7: 实现 Login.tsx / App.tsx / main.tsx / styles.css**

```tsx
// web/src/Login.tsx
import { useState, type FormEvent } from 'react'
import { login } from './api'

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await login(password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>tmux webui</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          autoFocus
        />
        <button type="submit" disabled={busy || password.length === 0}>
          {busy ? '登录中…' : '登录'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  )
}
```

```tsx
// web/src/App.tsx （本任务先做登录态骨架，主界面在 Task 13 填充）
import { useState } from 'react'
import { Login } from './Login'

export function App() {
  const [authed, setAuthed] = useState(false)
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <div className="app">已登录</div>
}
```

```tsx
// web/src/main.tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import '@xterm/xterm/css/xterm.css'

createRoot(document.getElementById('root')!).render(<App />)
```

```css
/* web/src/styles.css */
:root {
  color-scheme: dark;
  --bg: #1a1b26;
  --bg-alt: #16161e;
  --fg: #c0caf5;
  --accent: #7aa2f7;
  --border: #2f3549;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; }
.login-page { display: flex; align-items: center; justify-content: center; height: 100vh; }
.login-card { display: flex; flex-direction: column; gap: 12px; width: min(320px, 90vw); }
.login-card h1 { margin: 0 0 8px; font-size: 20px; text-align: center; }
.login-card input, .login-card button {
  padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg-alt); color: var(--fg); font-size: 14px;
}
.login-card button { background: var(--accent); color: #16161e; cursor: pointer; font-weight: 600; }
.login-card button:disabled { opacity: 0.5; cursor: default; }
.error { color: #f7768e; margin: 0; font-size: 13px; }
```

- [ ] **Step 8: 类型检查 + 构建验证**

Run: `cd web && npx tsc --noEmit && npx vite build`
Expected: 无类型错误，构建产出 `web/dist/`

- [ ] **Step 9: Commit**

```bash
git add web
git commit -m "feat: 前端脚手架、API client 与登录页"
```

---

### Task 13: 前端主界面（侧边栏 + window tabs + xterm 终端）

**Files:**
- Create: `web/src/useSessions.ts`, `web/src/SessionSidebar.tsx`, `web/src/WindowTabs.tsx`, `web/src/TerminalView.tsx`
- Modify: `web/src/App.tsx`（替换 Task 12 的骨架）, `web/src/styles.css`（追加）
- Test: `web/src/WindowTabs.test.tsx`

**Interfaces:**
- Consumes: `ApiSession`/`ApiWindow`/`fetchSessions`/`AuthError`/`logout`（Task 12）；后端 WS 帧协议（Task 10）
- Produces:
  - `function useSessions(onAuthLost: () => void): { sessions: ApiSession[]; error?: string }`（5 秒轮询）
  - `<SessionSidebar sessions selected onSelect />`
  - `<WindowTabs windows selected onSelect />`
  - `<TerminalView session windowIndex />`（内部管理 WS + xterm；session 变更时重连；windowIndex 变更时发 `w` 帧）

- [ ] **Step 1: 写失败测试 WindowTabs.test.tsx**

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WindowTabs } from './WindowTabs'

const windows = [
  { index: 0, name: 'claude', active: true },
  { index: 1, name: 'logs', active: false },
]

describe('WindowTabs', () => {
  it('渲染所有 window 名并高亮选中项', () => {
    render(<WindowTabs windows={windows} selected={1} onSelect={() => undefined} />)
    expect(screen.getByText('0: claude')).toBeDefined()
    const selectedTab = screen.getByText('1: logs')
    expect(selectedTab.className).toContain('selected')
  })

  it('点击 tab 触发 onSelect', () => {
    const onSelect = vi.fn()
    render(<WindowTabs windows={windows} selected={0} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('1: logs'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run src/WindowTabs.test.tsx`
Expected: FAIL —— 找不到 `./WindowTabs`

- [ ] **Step 3: 实现 WindowTabs.tsx 与 SessionSidebar.tsx**

```tsx
// web/src/WindowTabs.tsx
import type { ApiWindow } from './api'

interface Props {
  windows: ApiWindow[]
  selected: number
  onSelect: (index: number) => void
}

export function WindowTabs({ windows, selected, onSelect }: Props) {
  return (
    <nav className="window-tabs">
      {windows.map((w) => (
        <button
          key={w.index}
          className={`tab${w.index === selected ? ' selected' : ''}`}
          onClick={() => onSelect(w.index)}
        >
          {w.index}: {w.name}
        </button>
      ))}
    </nav>
  )
}
```

```tsx
// web/src/SessionSidebar.tsx
import type { ApiSession } from './api'

interface Props {
  sessions: ApiSession[]
  selected: string | undefined
  onSelect: (name: string) => void
}

export function SessionSidebar({ sessions, selected, onSelect }: Props) {
  return (
    <aside className="sidebar">
      <h2>Sessions</h2>
      <ul>
        {sessions.map((s) => (
          <li key={s.name}>
            <button
              className={`session${s.name === selected ? ' selected' : ''}`}
              onClick={() => onSelect(s.name)}
            >
              <span className="dot" data-attached={s.attached} />
              {s.name}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && npx vitest run src/WindowTabs.test.tsx`
Expected: PASS（2 个用例）

- [ ] **Step 5: 实现 useSessions.ts**

```ts
// web/src/useSessions.ts
import { useEffect, useState } from 'react'
import { AuthError, fetchSessions, type ApiSession } from './api'

const POLL_MS = 5000

export function useSessions(onAuthLost: () => void): {
  sessions: ApiSession[]
  error?: string
} {
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let stopped = false
    async function poll() {
      try {
        const data = await fetchSessions()
        if (!stopped) {
          setSessions(data)
          setError(undefined)
        }
      } catch (err) {
        if (stopped) return
        if (err instanceof AuthError) {
          onAuthLost()
          return
        }
        setError(err instanceof Error ? err.message : '获取会话列表失败')
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [onAuthLost])

  return { sessions, error }
}
```

- [ ] **Step 6: 实现 TerminalView.tsx**

```tsx
// web/src/TerminalView.tsx
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

interface Props {
  session: string
  windowIndex: number
}

type Status = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export function TerminalView({ session, windowIndex }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | undefined>(undefined)
  const [status, setStatus] = useState<Status>('connecting')

  // session 变化：重建 xterm + WS
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({ fontSize: 14, fontFamily: 'monospace', scrollback: 0 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()

    let disposed = false
    let retryDelay = 500

    function connect(winIndex: number) {
      setStatus((s) => (s === 'connected' ? 'reconnecting' : 'connecting'))
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(
        `${proto}://${location.host}/ws/terminal?session=${encodeURIComponent(session)}&window=${winIndex}`,
      )
      wsRef.current = ws
      ws.onopen = () => {
        retryDelay = 500
        setStatus('connected')
        ws.send(`r${JSON.stringify({ cols: term.cols, rows: term.rows })}`)
      }
      ws.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : '')
      ws.onclose = (ev) => {
        if (disposed || ev.code === 4401) {
          setStatus('closed')
          return
        }
        setStatus('reconnecting')
        setTimeout(() => {
          if (!disposed) connect(winIndexRef.current)
        }, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 10_000)
      }
    }

    const winIndexRef = { current: windowIndex }
    connect(windowIndex)

    const dataSub = term.onData((d) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(`i${d}`)
    })

    const observer = new ResizeObserver(() => {
      fit.fit()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(`r${JSON.stringify({ cols: term.cols, rows: term.rows })}`)
      }
    })
    observer.observe(container)

    // 暴露给第二个 effect 用于切 window
    ;(container as HTMLDivElement & { __winIndexRef?: { current: number } }).__winIndexRef =
      winIndexRef

    return () => {
      disposed = true
      observer.disconnect()
      dataSub.dispose()
      wsRef.current?.close()
      term.dispose()
    }
    // windowIndex 故意不在依赖里：切 window 走下面的 effect，不重连
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // windowIndex 变化：只发 w 帧
  useEffect(() => {
    const container = containerRef.current as
      | (HTMLDivElement & { __winIndexRef?: { current: number } })
      | null
    if (container?.__winIndexRef) container.__winIndexRef.current = windowIndex
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(`w${JSON.stringify({ index: windowIndex })}`)
    }
  }, [windowIndex])

  return (
    <div className="terminal-wrap">
      {status !== 'connected' && (
        <div className="terminal-status">
          {status === 'connecting' && '连接中…'}
          {status === 'reconnecting' && '连接断开，正在重连…'}
          {status === 'closed' && '连接已关闭，请刷新页面'}
        </div>
      )}
      <div className="terminal" ref={containerRef} />
    </div>
  )
}
```

- [ ] **Step 7: 替换 App.tsx 并追加样式**

```tsx
// web/src/App.tsx
import { useCallback, useState } from 'react'
import { Login } from './Login'
import { SessionSidebar } from './SessionSidebar'
import { TerminalView } from './TerminalView'
import { WindowTabs } from './WindowTabs'
import { useSessions } from './useSessions'

function Main({ onAuthLost }: { onAuthLost: () => void }) {
  const { sessions, error } = useSessions(onAuthLost)
  const [selectedSession, setSelectedSession] = useState<string | undefined>()
  const [selectedWindow, setSelectedWindow] = useState(0)

  const current = sessions.find((s) => s.name === selectedSession) ?? sessions[0]
  const currentWindow =
    current?.windows.find((w) => w.index === selectedWindow) ?? current?.windows[0]

  function handleSelectSession(name: string) {
    setSelectedSession(name)
    setSelectedWindow(0)
  }

  return (
    <div className="app">
      <SessionSidebar
        sessions={sessions}
        selected={current?.name}
        onSelect={handleSelectSession}
      />
      <main className="main">
        {error && <div className="banner-error">{error}</div>}
        {current && currentWindow ? (
          <>
            <WindowTabs
              windows={current.windows}
              selected={currentWindow.index}
              onSelect={setSelectedWindow}
            />
            <TerminalView session={current.name} windowIndex={currentWindow.index} />
          </>
        ) : (
          <div className="empty">没有可用的 tmux session</div>
        )}
      </main>
    </div>
  )
}

export function App() {
  const [authed, setAuthed] = useState(false)
  const onAuthLost = useCallback(() => setAuthed(false), [])
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />
  return <Main onAuthLost={onAuthLost} />
}
```

```css
/* 追加到 web/src/styles.css */
.app { display: flex; height: 100vh; }
.sidebar { width: 200px; background: var(--bg-alt); border-right: 1px solid var(--border); padding: 12px; overflow-y: auto; flex-shrink: 0; }
.sidebar h2 { font-size: 12px; text-transform: uppercase; opacity: 0.6; margin: 0 0 8px; }
.sidebar ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.sidebar .session { width: 100%; text-align: left; padding: 8px 10px; border: none; border-radius: 6px; background: transparent; color: var(--fg); cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 14px; }
.sidebar .session:hover { background: var(--border); }
.sidebar .session.selected { background: var(--accent); color: var(--bg-alt); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #565f89; flex-shrink: 0; }
.dot[data-attached='true'] { background: #9ece6a; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.window-tabs { display: flex; gap: 2px; background: var(--bg-alt); border-bottom: 1px solid var(--border); padding: 6px 8px 0; overflow-x: auto; }
.tab { padding: 8px 14px; border: none; border-radius: 6px 6px 0 0; background: transparent; color: var(--fg); cursor: pointer; font-size: 13px; white-space: nowrap; }
.tab.selected { background: var(--bg); color: var(--accent); font-weight: 600; }
.terminal-wrap { flex: 1; position: relative; min-height: 0; }
.terminal { position: absolute; inset: 0; padding: 4px; }
.terminal-status { position: absolute; top: 8px; right: 12px; z-index: 10; background: var(--bg-alt); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 12px; }
.banner-error { background: #f7768e22; color: #f7768e; padding: 8px 12px; font-size: 13px; }
.empty { display: flex; align-items: center; justify-content: center; flex: 1; opacity: 0.6; }
@media (max-width: 700px) {
  .sidebar { width: 64px; padding: 8px 4px; }
  .sidebar h2 { display: none; }
  .sidebar .session { justify-content: center; padding: 8px 4px; font-size: 11px; overflow: hidden; }
}
```

- [ ] **Step 8: 全量验证**

Run: `cd web && npx vitest run && npx tsc --noEmit && npx vite build`
Expected: 测试全 PASS，无类型错误，构建成功

- [ ] **Step 9: Commit**

```bash
git add web/src
git commit -m "feat: 主界面（session 侧边栏 + window tabs + xterm 终端）"
```

---

### Task 14: E2E 测试 + README

**Files:**
- Create: `e2e/webui.spec.ts`, `playwright.config.ts`, `e2e/setup-tmux.sh`, `README.md`
- Modify: `package.json`（追加 `@playwright/test` devDep 与 `test:e2e` script）

**Interfaces:**
- Consumes: 完整系统（Task 1-13）
- Produces: `npm run test:e2e` 一键跑通 登录→列表→切 window→输入回显 全流程

- [ ] **Step 1: 安装 Playwright 并加 script**

Run: `npm install -D @playwright/test && npx playwright install chromium`

package.json scripts 追加：

```json
"test:e2e": "bash e2e/setup-tmux.sh && playwright test"
```

- [ ] **Step 2: 创建 e2e/setup-tmux.sh**

```bash
#!/usr/bin/env bash
# 为 E2E 准备独立 tmux server（不触碰用户默认 server）
set -euo pipefail
SOCKET=webui-e2e
tmux -L "$SOCKET" kill-server 2>/dev/null || true
tmux -L "$SOCKET" new-session -d -s demo -n first
tmux -L "$SOCKET" new-window -t demo -n second
echo "e2e tmux server ready (socket: $SOCKET)"
```

- [ ] **Step 3: 创建 playwright.config.ts**

```ts
import { defineConfig } from '@playwright/test'

const E2E_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy' // bcrypt('secret')

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:18090' },
  webServer: {
    command: 'npm run build && node dist/main.js',
    url: 'http://127.0.0.1:18090',
    env: {
      TMUX_WEBUI_PASSWORD_HASH: E2E_HASH,
      TMUX_WEBUI_PORT: '18090',
      TMUX_WEBUI_SOCKET: 'webui-e2e',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
```

- [ ] **Step 4: 写 e2e/webui.spec.ts**

```ts
import { expect, test } from '@playwright/test'

test('登录 → 看到 session → 切 window → 输入并看到回显', async ({ page }) => {
  await page.goto('/')

  // 登录
  await page.getByPlaceholder('密码').fill('secret')
  await page.getByRole('button', { name: '登录' }).click()

  // 侧边栏出现 demo session
  await expect(page.getByRole('button', { name: /demo/ })).toBeVisible()

  // 两个 window tab
  await expect(page.getByRole('button', { name: '0: first' })).toBeVisible()
  await expect(page.getByRole('button', { name: '1: second' })).toBeVisible()

  // 切到第二个 window
  await page.getByRole('button', { name: '1: second' }).click()

  // 在终端输入命令并验证回显
  const term = page.locator('.terminal')
  await term.click()
  await page.keyboard.type('echo e2e-marker-$((40+2))')
  await page.keyboard.press('Enter')
  await expect(page.locator('.xterm-screen')).toContainText('e2e-marker-42', {
    timeout: 10_000,
  })
})

test('密码错误显示错误信息', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('密码').fill('wrong')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('密码错误')).toBeVisible()
})
```

- [ ] **Step 5: 运行 E2E**

Run: `npm run test:e2e`
Expected: 2 个测试 PASS。跑完清理：`tmux -L webui-e2e kill-server`

- [ ] **Step 6: 写 README.md**

````markdown
# tmux-webui

浏览器里的 tmux：两级导航（session 侧边栏 + window tabs）查看并切换所有
tmux window，完整交互终端（xterm.js）。浏览器视图基于 tmux 分组会话，
与你本机 attach 的客户端**完全独立**，互不干扰。

## 快速开始

```bash
npm install && npm --prefix web install
npm run hash-password -- 你的密码     # 生成 TMUX_WEBUI_PASSWORD_HASH
export TMUX_WEBUI_PASSWORD_HASH='…'  # 粘贴上一步输出
npm run build && npm start           # http://127.0.0.1:8090
```

开发模式：`npm run dev`（后端）+ `npm --prefix web run dev`（前端，端口 5173，自动代理）。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `TMUX_WEBUI_PASSWORD_HASH` | 必填 | bcrypt 哈希，用 `npm run hash-password` 生成 |
| `TMUX_WEBUI_HOST` | `127.0.0.1` | 监听地址 |
| `TMUX_WEBUI_PORT` | `8090` | 监听端口 |
| `TMUX_WEBUI_SOCKET` | （默认 socket） | `tmux -L` socket 名 |
| `TMUX_WEBUI_SESSION_TTL_MS` | 7 天 | 登录有效期 |
| `TMUX_WEBUI_COOKIE_SECURE` | `false` | HTTPS 反代后设为 `true` |

## 安全须知

浏览器终端 = shell 完整权限。**切勿**把本服务直接裸露在公网：

- 保持默认只监听 `127.0.0.1`，通过 Tailscale 或带 HTTPS 的反向代理访问
- 反代 TLS 后设置 `TMUX_WEBUI_COOKIE_SECURE=true`

## 测试

```bash
npm test                  # 后端单元 + 集成（独立 tmux socket）
npm --prefix web test     # 前端单元
npm run test:e2e          # Playwright 全流程
```
````

- [ ] **Step 7: 全量回归 + Commit**

Run: `npx vitest run && cd web && npx vitest run && cd .. && npx tsc --noEmit`
Expected: 全部 PASS

```bash
git add e2e playwright.config.ts README.md package.json package-lock.json
git commit -m "test: Playwright E2E 全流程 + docs: README"
```

---

## Self-Review 记录

1. **Spec 覆盖**：两级导航（Task 13）、交互终端（Task 10/13）、独立视图（Task 5）、认证+限速+cookie（Task 6-9）、127.0.0.1 绑定与 cookieSecure（Task 2/11）、孤儿清理（Task 5/11）、错误处理（NO_SERVER→503 Task 9、pty 退出→4410 Task 10、断线重连 Task 13）、测试三层（单元/集成/E2E）——全部有对应任务。非目标（session 管理操作等）确认未混入。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
3. **类型一致性**：`TmuxExec`/`TmuxError`（Task 3）、`VIEW_PREFIX`/`TmuxSession`（Task 4）、`View`（Task 5）、`SessionStore`（Task 7）、`RateLimiter`（Task 8）、`COOKIE_NAME`（Task 9 middleware，Task 10 复用）、`PtyLike`/`SpawnPty`/`TerminalDeps`（Task 10，Task 11 复用）、`ApiSession`/`ApiWindow`（Task 12，Task 13 复用）——命名与签名跨任务一致。
