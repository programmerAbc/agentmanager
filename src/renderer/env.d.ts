/// <reference types="vite/client" />
import type { Api } from '../shared/types'

declare global {
  interface Window {
    api: Api
    /** 仅开发模式存在的自测钩子 */
    __agentDesk?: { terminals: () => unknown }
  }
}

export {}
