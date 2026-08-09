import type { ITheme } from '@xterm/xterm'

export const APPEARANCE_STORAGE_KEY = 'tmux-webui.appearance.v1'

export type ThemeId =
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'dracula'
  | 'nord'
  | 'solarized-dark'
  | 'gruvbox-dark'
export type FontId =
  | 'system-mono'
  | 'jetbrains-mono'
  | 'cascadia-mono'
  | 'sf-mono'
  | 'fira-code'
  | 'iosevka'
export type CursorStyle = 'block' | 'bar' | 'underline'
export type LineHeight = 1 | 1.1 | 1.2 | 1.3

export interface AppearanceSettings {
  theme: ThemeId
  font: FontId
  fontSize: number
  lineHeight: LineHeight
  cursorStyle: CursorStyle
}

interface ThemePreview {
  background: string
  foreground: string
  accent: string
  green: string
  yellow: string
  red: string
}

interface ThemeDefinition {
  id: ThemeId
  label: string
  description: string
  preview: ThemePreview
  terminal: ITheme
}

interface FontDefinition {
  id: FontId
  label: string
  stack: string
}

const createTerminalTheme = (
  preview: ThemePreview,
  colors: {
    black: string
    blue: string
    cyan: string
    magenta: string
    brightBlack: string
  },
): ITheme => ({
  background: preview.background,
  foreground: preview.foreground,
  cursor: preview.accent,
  cursorAccent: preview.background,
  selectionBackground: `${preview.accent}55`,
  black: colors.black,
  red: preview.red,
  green: preview.green,
  yellow: preview.yellow,
  blue: colors.blue,
  magenta: colors.magenta,
  cyan: colors.cyan,
  white: preview.foreground,
  brightBlack: colors.brightBlack,
  brightRed: preview.red,
  brightGreen: preview.green,
  brightYellow: preview.yellow,
  brightBlue: preview.accent,
  brightMagenta: colors.magenta,
  brightCyan: colors.cyan,
  brightWhite: '#ffffff',
})

const tokyoNight = {
  background: '#1a1b26',
  foreground: '#c0caf5',
  accent: '#7aa2f7',
  green: '#9ece6a',
  yellow: '#e0af68',
  red: '#f7768e',
} satisfies ThemePreview
const catppuccin = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  accent: '#89b4fa',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  red: '#f38ba8',
} satisfies ThemePreview
const dracula = {
  background: '#282a36',
  foreground: '#f8f8f2',
  accent: '#bd93f9',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  red: '#ff5555',
} satisfies ThemePreview
const nord = {
  background: '#2e3440',
  foreground: '#d8dee9',
  accent: '#88c0d0',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  red: '#bf616a',
} satisfies ThemePreview
const solarized = {
  background: '#002b36',
  foreground: '#839496',
  accent: '#268bd2',
  green: '#859900',
  yellow: '#b58900',
  red: '#dc322f',
} satisfies ThemePreview
const gruvbox = {
  background: '#282828',
  foreground: '#ebdbb2',
  accent: '#83a598',
  green: '#b8bb26',
  yellow: '#fabd2f',
  red: '#fb4934',
} satisfies ThemePreview

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    description: '冷静的深蓝与霓虹蓝',
    preview: tokyoNight,
    terminal: createTerminalTheme(tokyoNight, {
      black: '#15161e',
      blue: '#7aa2f7',
      cyan: '#7dcfff',
      magenta: '#bb9af7',
      brightBlack: '#565f89',
    }),
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    description: '柔和的摩卡与薰衣草色',
    preview: catppuccin,
    terminal: createTerminalTheme(catppuccin, {
      black: '#181825',
      blue: '#89b4fa',
      cyan: '#89dceb',
      magenta: '#cba6f7',
      brightBlack: '#6c7086',
    }),
  },
  {
    id: 'dracula',
    label: 'Dracula',
    description: '高对比紫色经典配色',
    preview: dracula,
    terminal: createTerminalTheme(dracula, {
      black: '#21222c',
      blue: '#6272a4',
      cyan: '#8be9fd',
      magenta: '#ff79c6',
      brightBlack: '#6272a4',
    }),
  },
  {
    id: 'nord',
    label: 'Nord',
    description: '低饱和的北欧冰川色',
    preview: nord,
    terminal: createTerminalTheme(nord, {
      black: '#242933',
      blue: '#81a1c1',
      cyan: '#8fbcbb',
      magenta: '#b48ead',
      brightBlack: '#7b88a1',
    }),
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    description: '护眼的经典蓝绿色调',
    preview: solarized,
    terminal: createTerminalTheme(solarized, {
      black: '#073642',
      blue: '#268bd2',
      cyan: '#2aa198',
      magenta: '#6c71c4',
      brightBlack: '#586e75',
    }),
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    description: '复古温暖的高可读配色',
    preview: gruvbox,
    terminal: createTerminalTheme(gruvbox, {
      black: '#1d2021',
      blue: '#83a598',
      cyan: '#8ec07c',
      magenta: '#d3869b',
      brightBlack: '#928374',
    }),
  },
]

export const FONT_OPTIONS: readonly FontDefinition[] = [
  {
    id: 'system-mono',
    label: 'System Mono',
    stack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: '"JetBrains Mono", ui-monospace, monospace',
  },
  {
    id: 'cascadia-mono',
    label: 'Cascadia Mono',
    stack: '"Cascadia Mono", "Cascadia Code", ui-monospace, monospace',
  },
  { id: 'sf-mono', label: 'SF Mono', stack: '"SF Mono", SFMono-Regular, ui-monospace, monospace' },
  { id: 'fira-code', label: 'Fira Code', stack: '"Fira Code", ui-monospace, monospace' },
  { id: 'iosevka', label: 'Iosevka', stack: 'Iosevka, ui-monospace, monospace' },
]

export const LINE_HEIGHT_OPTIONS: readonly LineHeight[] = [1, 1.1, 1.2, 1.3]
export const CURSOR_OPTIONS: readonly { id: CursorStyle; label: string }[] = [
  { id: 'block', label: '方块' },
  { id: 'bar', label: '竖线' },
  { id: 'underline', label: '下划线' },
]

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'tokyo-night',
  font: 'system-mono',
  fontSize: 14,
  lineHeight: 1,
  cursorStyle: 'block',
}

export const themeById = (id: ThemeId): ThemeDefinition =>
  THEMES.find((theme) => theme.id === id) ?? THEMES[0]
export const fontById = (id: FontId): FontDefinition =>
  FONT_OPTIONS.find((font) => font.id === id) ?? FONT_OPTIONS[0]

const isAppearanceSettings = (value: unknown): value is AppearanceSettings => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    THEMES.some(({ id }) => id === candidate.theme) &&
    FONT_OPTIONS.some(({ id }) => id === candidate.font) &&
    typeof candidate.fontSize === 'number' &&
    Number.isInteger(candidate.fontSize) &&
    candidate.fontSize >= 10 &&
    candidate.fontSize <= 24 &&
    LINE_HEIGHT_OPTIONS.includes(candidate.lineHeight as LineHeight) &&
    CURSOR_OPTIONS.some(({ id }) => id === candidate.cursorStyle)
  )
}

export const loadAppearance = (): AppearanceSettings => {
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_APPEARANCE }
    const parsed: unknown = JSON.parse(stored)
    return isAppearanceSettings(parsed) ? parsed : { ...DEFAULT_APPEARANCE }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export const saveAppearance = (settings: AppearanceSettings): void => {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings))
}

export const applyAppearance = (settings: AppearanceSettings): void => {
  document.documentElement.dataset.theme = settings.theme
}
