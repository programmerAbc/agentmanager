import { app } from 'electron'
import log from 'electron-log/main'
import path from 'node:path'

// 日志写到 userData/logs/main.log
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log')
log.transports.file.level = 'info'
log.transports.console.level = app.isPackaged ? false : 'debug'

// 兜底：未捕获的异常只记日志，不让主进程崩溃
log.errorHandler.startCatching({ showDialog: false })

export default log
