#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ALL_PROVIDERS = ['codex', 'claude', 'pi', 'kimi', 'opencode']
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const hookScript = path.join(repoRoot, 'scripts', 'agent-status-hook.sh')

function parseArgs(argv) {
  let configHome = homedir()
  const providers = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config-home') {
      const value = argv[index + 1]
      if (!value) throw new Error('--config-home 需要一个目录')
      configHome = path.resolve(value)
      index += 1
    } else {
      providers.push(arg)
    }
  }
  const selected = providers.length > 0 ? providers : ALL_PROVIDERS
  for (const provider of selected) {
    if (!ALL_PROVIDERS.includes(provider)) throw new Error(`未知 agent: ${provider}`)
  }
  return { configHome, providers: [...new Set(selected)] }
}

function readJson(file) {
  if (!existsSync(file)) return {}
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} 顶层必须是 JSON 对象`)
  }
  return value
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o600
  const temp = `${file}.tmux-webui-${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode })
  renameSync(temp, file)
  chmodSync(file, mode)
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function commandFor(provider, status) {
  return `bash ${shellQuote(hookScript)} ${provider} ${status}`
}

function updateExistingStatusHook(groups, provider, status) {
  const pattern = new RegExp(`\\b${provider}\\s+${status}(?:\\s|$)`)
  let found = false
  for (const group of groups) {
    for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
      if (
        typeof hook?.command === 'string' &&
        hook.command.includes('agent-status-hook.sh') &&
        pattern.test(hook.command)
      ) {
        hook.command = commandFor(provider, status)
        found = true
      }
    }
  }
  return found
}

function mergeJsonHooks(file, provider, events) {
  const config = readJson(file)
  if (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== 'object')) {
    throw new Error(`${file} 的 hooks 必须是对象`)
  }
  const hooks = config.hooks ?? {}
  for (const [event, status] of events) {
    const groups = hooks[event] ?? []
    if (!Array.isArray(groups)) throw new Error(`${file} 的 hooks.${event} 必须是数组`)
    if (!updateExistingStatusHook(groups, provider, status)) {
      groups.push({
        hooks: [{ type: 'command', command: commandFor(provider, status) }],
      })
    }
    hooks[event] = groups
  }
  config.hooks = hooks
  writeJsonAtomic(file, config)
}

function installCodex(configHome) {
  mergeJsonHooks(path.join(configHome, '.codex', 'hooks.json'), 'codex', [
    ['SessionStart', 'idle'],
    ['UserPromptSubmit', 'running'],
    ['Stop', 'idle'],
    ['SessionEnd', 'clear'],
  ])
}

function installClaude(configHome) {
  mergeJsonHooks(path.join(configHome, '.claude', 'settings.json'), 'claude', [
    ['SessionStart', 'idle'],
    ['UserPromptSubmit', 'running'],
    ['Stop', 'idle'],
    ['StopFailure', 'idle'],
    ['SessionEnd', 'clear'],
  ])
}

function copyIntegration(configHome, source, destination) {
  const target = path.join(configHome, destination)
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  copyFileSync(path.join(repoRoot, 'integrations', source), target)
  chmodSync(target, 0o644)
}

function installPi(configHome) {
  copyIntegration(
    configHome,
    'pi-status.js',
    path.join('.pi', 'agent', 'extensions', 'tmux-webui-status.js'),
  )
}

function installOpenCode(configHome) {
  copyIntegration(
    configHome,
    'opencode-status.js',
    path.join('.config', 'opencode', 'plugins', 'tmux-webui-status.js'),
  )
}

function installKimi(configHome) {
  const file = path.join(configHome, '.kimi-code', 'config.toml')
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''

  const rules = [
    ['SessionStart', 'idle'],
    ['UserPromptSubmit', 'running'],
    ['Stop', 'idle'],
    ['StopFailure', 'idle'],
    ['Interrupt', 'idle'],
    ['SessionEnd', 'clear'],
  ]
  const block = rules
    .map(
      ([event, status]) =>
        `[[hooks]]\nevent = "${event}"\ncommand = ${JSON.stringify(commandFor('kimi', status))}`,
    )
    .join('\n\n')
  const startMarker = '# tmux-webui agent status: start'
  const endMarker = '# tmux-webui agent status: end'
  const managedBlock = `${startMarker}\n${block}\n${endMarker}`
  const start = existing.indexOf(startMarker)
  const end = existing.indexOf(endMarker)
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error(`${file} 的 tmux-webui 状态区块不完整`)
  }

  let next
  if (start !== -1) {
    next = `${existing.slice(0, start)}${managedBlock}${existing.slice(end + endMarker.length)}`
  } else {
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    next = `${existing}${separator}\n${managedBlock}\n`
  }
  writeFileSync(file, next, {
    mode: existsSync(file) ? statSync(file).mode & 0o777 : 0o600,
  })
}

try {
  const { configHome, providers } = parseArgs(process.argv.slice(2))
  const installers = {
    codex: installCodex,
    claude: installClaude,
    pi: installPi,
    kimi: installKimi,
    opencode: installOpenCode,
  }
  for (const provider of providers) {
    installers[provider](configHome)
    console.log(`已安装 ${provider} 状态集成`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
