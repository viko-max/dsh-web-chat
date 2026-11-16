// Host 插件构建：esbuild CLI 打包为自包含 ESM bundle（与原版 lib/index.js 形态一致）。
// 用 CLI + stdio inherit 而非 JS API：沙箱禁止管道式子进程输出捕获。
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.dirname(fileURLToPath(import.meta.url))
const esbuildPkg = require.resolve('esbuild/package.json')
const bin = path.join(path.dirname(esbuildPkg), 'bin', 'esbuild')

const banner =
  "import { createRequire as createBundleRequire } from 'node:module'; const require = createBundleRequire(import.meta.url);"

const offline = process.argv.includes('--offline')

const result = spawnSync(
  process.execPath,
  [
    bin,
    'src/panel-host.js',
    '--bundle',
    '--platform=node',
    '--target=node24',
    '--format=esm',
    `--outfile=${offline ? 'dist/lib/index.offline.js' : 'dist/lib/index.js'}`,
    `--banner:js=${banner}`,
    ...(offline ? ['--define:DSWC_OFFLINE=true'] : []),
    '--log-level=info',
  ],
  { cwd: root, stdio: 'inherit' }
)
process.exit(result.status ?? 1)