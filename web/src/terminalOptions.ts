import type { ITerminalOptions } from '@xterm/xterm'
import {
  DEFAULT_APPEARANCE,
  fontById,
  themeById,
  type AppearanceSettings,
} from './appearance'

const BASE_TERMINAL_OPTIONS: ITerminalOptions = {
  // Keep enough output for long-running CLI sessions such as Codex.
  scrollback: 10_000,
  allowProposedApi: true,
}

export const terminalOptionsForAppearance = (appearance: AppearanceSettings): ITerminalOptions => ({
  ...BASE_TERMINAL_OPTIONS,
  fontSize: appearance.fontSize,
  fontFamily: fontById(appearance.font).stack,
  lineHeight: appearance.lineHeight,
  cursorStyle: appearance.cursorStyle,
  theme: themeById(appearance.theme).terminal,
})

export const TERMINAL_OPTIONS = terminalOptionsForAppearance(DEFAULT_APPEARANCE)
