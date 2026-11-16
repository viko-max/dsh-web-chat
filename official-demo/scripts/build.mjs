// 跨平台生产构建：设置 NODE_ENV 并调用 rspack CLI（替代上游的 Unix shell 写法）。
// output.clean 已负责清理 dist，无需 rm -rf。
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkgPath = require.resolve('@rspack/cli/package.json')
const pkg = require(pkgPath)
const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.rspack
const cli = path.join(path.dirname(pkgPath), bin)

const result = spawnSync(process.execPath, [cli, 'build', '-c', 'rspack.config.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    ...(process.argv.includes('--panel') ? { DSWC_PANEL: '1' } : {}),
  },
})
process.exit(result.status ?? 1)