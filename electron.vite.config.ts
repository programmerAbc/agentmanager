import { defineConfig } from 'electron-vite'

// 入口使用 electron-vite 的默认约定：
//   src/main/index.ts、src/preload/index.ts、src/renderer/index.html
// 依赖默认 externalize（node-pty、electron-log 运行时从 node_modules 加载）。
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    server: {
      // Vite 默认把 localhost 解析成 ::1 监听，而 Electron 在部分 Windows 环境下只走 IPv4，
      // 会出现 ERR_CONNECTION_REFUSED。显式绑定 IPv4 回环地址。
      host: '127.0.0.1'
    }
  }
})
