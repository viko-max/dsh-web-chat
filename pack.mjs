// 组装并打包桌面安装包：staging/package/* -> desktop/dsh-web-chat-<version>-desktop.tgz
// 用法：node pack.mjs [--skip-build] [--offline] [--node-tar]
//   --offline   离线验收包（本机模拟服务，无需 API Key）
//   --node-tar  强制用内置 Node tar 写入器（不依赖 python）
// 构建工具按「显式环境变量 → 当前 Node 运行时同级依赖 → PATH」发现，不硬编码任何用户目录：
//   DSWC_PNPM_PATH / DSWC_PYTHON_PATH 可显式指定 pnpm 脚本与 python 可执行文件。
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const skipBuild = process.argv.includes('--skip-build')
const offline = process.argv.includes('--offline')
const forceNodeTar = process.argv.includes('--node-tar')
const node = process.execPath
const require = createRequire(import.meta.url)

const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`命令失败：${cmd} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

// 当前 Node 运行时所在的依赖根（.../dependencies），用于发现同级 pnpm/python，不含用户目录字面量
const depsDir = path.dirname(path.dirname(path.dirname(process.execPath)))
const findTool = (envVar, relatives, pathNames) => {
  const explicit = process.env[envVar]
  if (explicit && existsSync(explicit)) return explicit
  for (const rel of relatives) {
    const candidate = path.join(depsDir, rel)
    if (existsSync(candidate)) return candidate
  }
  for (const name of pathNames) {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
    if (probe.status === 0) {
      const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      if (first) return first
    }
  }
  return null
}

// 1. 构建 Host 与面板
if (!skipBuild) {
  run(node, ['build.mjs', ...(offline ? ['--offline'] : [])], path.join(root, 'host-src'))
  const pnpm = findTool('DSWC_PNPM_PATH', ['pnpm/bin/pnpm.mjs', 'pnpm/bin/pnpm.cjs'], ['pnpm'])
  if (!pnpm) {
    console.error('未找到 pnpm。请设置 DSWC_PNPM_PATH 指向 pnpm.mjs，或确保 pnpm 在 PATH 中。')
    process.exit(1)
  }
  if (/\.(mjs|cjs|js)$/.test(pnpm)) {
    run(node, [pnpm, 'run', 'build:panel'], path.join(root, 'official-demo'))
  } else {
    run(pnpm, ['run', 'build:panel'], path.join(root, 'official-demo'))
  }
}

// 2. 组装 staging
const version = '0.6.0'
const staging = path.join(root, 'dist-package', 'package')
rmSync(path.join(root, 'dist-package'), { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

const manifest = {
  name: 'dsh-web-chat',
  version,
  description: offline
    ? 'DeepSeek 对话面板（离线验收：本机模拟服务，无需 API Key）'
    : 'DeepSeek 对话面板、用量统计、语音、应用连接与桌宠',
  author: 'meiko',
  license: 'MIT',
  repository: { type: 'git', url: 'https://github.com/viko-max/dsh-web-chat.git' },
  type: 'module',
  engines: { node: '>=24.9.0', dsh: '0.2.2-rc.3' },
  main: './lib/index.js',
  exports: {
    '.': './lib/index.js',
    './client': './lib/client.js',
    './desktop.patch.yml': './desktop.patch.yml',
    './package.json': './package.json',
    './locale/*.json': './locale/*.json',
    './icon': './icon.svg',
  },
  dsh: {
    bundle: { patch: './desktop.patch.yml' },
    client: { platform: 'web' },
  },
  files: ['lib', 'demo', 'desktop.patch.yml', 'README.md', 'LICENSE', 'LICENSE-*', 'locale', 'docs', 'icon.svg'],
}
writeFileSync(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

mkdirSync(path.join(staging, 'lib'), { recursive: true })
cpSync(
  path.join(root, offline ? 'host-src/dist/lib/index.offline.js' : 'host-src/dist/lib/index.js'),
  path.join(staging, 'lib/index.js')
)
cpSync(path.join(root, 'client/client.js'), path.join(staging, 'lib/client.js'))
cpSync(path.join(root, 'official-demo/dist'), path.join(staging, 'demo'), { recursive: true })
cpSync(path.join(root, 'desktop.patch.yml'), path.join(staging, 'desktop.patch.yml'))
cpSync(path.join(root, 'README.md'), path.join(staging, 'README.md'))
cpSync(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'))
for (const license of ['LICENSE-chat-demo', 'LICENSE-fflate']) {
  cpSync(path.join(root, license), path.join(staging, license))
}
// 投稿资产：图标 + 中英文 locale + 单图详情页
cpSync(path.join(root, 'icon.svg'), path.join(staging, 'icon.svg'))
mkdirSync(path.join(staging, 'locale'), { recursive: true })
for (const locale of ['en.json', 'zh.json']) {
  cpSync(path.join(root, 'locale', locale), path.join(staging, 'locale', locale))
}
mkdirSync(path.join(staging, 'docs'), { recursive: true })
for (const doc of ['DETAIL.md', 'DETAIL.zh.md', 'preview.svg']) {
  cpSync(path.join(root, 'docs', doc), path.join(staging, 'docs', doc))
}

// 3. 校验清单 / 入口 / 面板资源 / 离线配置
const assert = (cond, message) => {
  if (!cond) {
    console.error(`包校验失败：${message}`)
    process.exit(1)
  }
}
const stagedManifest = JSON.parse(readFileSync(path.join(staging, 'package.json'), 'utf8'))
assert(stagedManifest.name === 'dsh-web-chat' && stagedManifest.version === version, '清单 name/version')
assert(existsSync(path.join(staging, 'lib/index.js')), 'Host 入口 lib/index.js')
assert(existsSync(path.join(staging, 'lib/client.js')), '客户端入口 lib/client.js')
assert(existsSync(path.join(staging, 'demo/index.html')), '面板资源 demo/index.html')
assert(existsSync(path.join(staging, 'desktop.patch.yml')), '桌面补丁 desktop.patch.yml')
assert(existsSync(path.join(staging, 'icon.svg')), '图标 icon.svg')
assert(existsSync(path.join(staging, 'locale/en.json')) && existsSync(path.join(staging, 'locale/zh.json')), '中英文 locale')
assert(existsSync(path.join(staging, 'docs/DETAIL.md')) && existsSync(path.join(staging, 'docs/preview.svg')), '详情页 docs/DETAIL.md + preview.svg')
assert(statSync(path.join(staging, 'icon.svg')).size <= 256 * 1024, '图标须 ≤256KiB')
const hostBundle = readFileSync(path.join(staging, 'lib/index.js'), 'utf8')
if (offline) {
  assert(hostBundle.includes('DSWC_OFFLINE') || hostBundle.includes('fixture'), '离线包应包含模拟服务配置')
} else {
  assert(!/var offline = true/.test(hostBundle), '正式包不应启用离线模式')
}

// 4. 打 tgz（npm 包格式：package/ 前缀）。优先 python tarfile；不可用时用内置 Node tar 写入器。
const out = path.join(root, 'desktop', `dsh-web-chat-${version}-desktop${offline ? '-offline' : ''}.tgz`)
mkdirSync(path.join(root, 'desktop'), { recursive: true })

const packTarNode = (srcDir, outFile) => {
  const fflate = require(path.join(root, 'official-demo/node_modules/fflate'))
  const header = (name, size, typeflag) => {
    const buf = Buffer.alloc(512)
    let prefix = ''
    let base = name
    if (Buffer.byteLength(name) > 100) {
      const slash = name.lastIndexOf('/', 100)
      prefix = name.slice(0, slash)
      base = name.slice(slash + 1)
    }
    buf.write(base.slice(0, 100), 0, 100, 'utf8')
    buf.write('0000644\0', 100, 8)
    buf.write('0000000\0', 108, 8)
    buf.write('0000000\0', 116, 8)
    buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12)
    buf.write('00000000000\0', 136, 12)
    buf.write('        ', 148, 8)
    buf.write(typeflag, 156, 1)
    buf.write('ustar\0', 257, 6)
    buf.write('00', 263, 2)
    if (prefix) buf.write(prefix.slice(0, 155), 345, 155, 'utf8')
    let sum = 0
    for (let i = 0; i < 512; i += 1) sum += buf[i]
    buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
    return buf
  }
  const chunks = []
  const walk = (dir, arcPrefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      const arc = arcPrefix + name
      const st = statSync(full)
      if (st.isDirectory()) {
        chunks.push(header(arc + '/', 0, '5'))
        walk(full, arc + '/')
      } else {
        const data = readFileSync(full)
        chunks.push(header(arc, data.length, '0'))
        chunks.push(data)
        const pad = (512 - (data.length % 512)) % 512
        if (pad) chunks.push(Buffer.alloc(pad))
      }
    }
  }
  walk(srcDir, 'package/')
  chunks.push(Buffer.alloc(1024))
  writeFileSync(outFile, Buffer.from(fflate.gzipSync(Buffer.concat(chunks))))
  console.log('packed (node tar):', outFile, statSync(outFile).size, 'bytes')
}

const python = forceNodeTar ? null : findTool('DSWC_PYTHON_PATH', ['python/python.exe', 'python/python3'], ['python', 'python3'])
if (python) {
  const code = `
import tarfile, os
src = ${JSON.stringify(staging)}
out = ${JSON.stringify(out)}
with tarfile.open(out, 'w:gz') as t:
    t.add(src, arcname='package')
print('packed:', out, os.path.getsize(out), 'bytes')
`
  run(python, ['-c', code], root)
} else {
  packTarNode(staging, out)
}
console.log(`\n安装包：${out}`)