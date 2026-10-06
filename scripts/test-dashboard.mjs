import { build } from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = await mkdtemp(path.join(tmpdir(), 'agentmanager-dashboard-tests-'))
try {
  const result = await build({ entryPoints: ['tests/dashboard.test.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
  const file = path.join(dir, 'tests.mjs')
  await writeFile(file, result.outputFiles[0].contents)
  await import(pathToFileURL(file).href)
} finally { await rm(dir, { recursive: true, force: true }) }
