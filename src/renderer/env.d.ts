/// <reference types="vite/client" />
import type { Api } from '../shared/types'

interface LocalFontData {
  family: string
  fullName: string
  postscriptName: string
  style: string
}

declare global {
  interface Window {
    api: Api
    /** Local Font Access API（Chromium） */
    queryLocalFonts?: () => Promise<LocalFontData[]>
    /** 仅开发模式存在的自测钩子 */
    __agentDesk?: { terminals: () => unknown }
  }
}

export {}
