// 生成并校验 DSH 插件市场索引（format 1），输出 market/index.json 与 market/entry.json。
// 用官方 @deepseek-ai/dsh-plugin-market-index 校验器验证，确保可被 DSH Discover 读取。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarketIndex, marketInstallTarget } from '../host-src/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const marketDir = path.join(root, 'market')
mkdirSync(marketDir, { recursive: true })

const en = JSON.parse(readFileSync(path.join(root, 'locale/en.json'), 'utf8')).meta
const zh = JSON.parse(readFileSync(path.join(root, 'locale/zh.json'), 'utf8')).meta
const iconSvg = readFileSync(path.join(root, 'icon.svg'))
const iconData = 'data:image/svg+xml;base64,' + iconSvg.toString('base64')
const repoUrl = 'https://github.com/viko-max/dsh-web-chat'
const indexUrl = 'https://raw.githubusercontent.com/viko-max/dsh-web-chat/main/market/index.json'
const publishTimestamp = Math.floor(Date.now() / 1000)
// 传入 40 位提交 SHA 则用 git 源（仓库内 bundle/ 目录）；否则用 npm 源
const gitCommit = process.argv[2]
if (gitCommit && !/^[0-9a-f]{40}$/.test(gitCommit)) {
  console.error('提交 SHA 须为 40 位小写十六进制')
  process.exit(1)
}
const source = gitCommit
  ? { type: 'git', url: repoUrl, commit: gitCommit, path: 'bundle' }
  : { type: 'npm' }

const entry = {
  name: 'dsh-web-chat',
  title: { en: en.title, zh: zh.title },
  description: { en: en.description, zh: zh.description },
  icon: iconData,
  author: 'meiko',
  homepage: repoUrl,
  repository: { url: repoUrl },
  metadata: {
    category: 'chat',
    keywords: ['chat', 'deepseek', 'image-generation', 'desk-pet', 'sidebar', 'automation', '对话', '生图', '桌宠', '侧栏'],
    labels: ['ui', 'host'],
  },
  versions: [
    {
      version: '0.6.0',
      publishTimestamp,
      source,
      engines: { dsh: '0.2.2-rc.3' },
    },
  ],
}

const index = {
  format: 1,
  title: { en: 'DSH web chat plugin index', zh: 'DSH 网页对话插件索引' },
  description: {
    en: 'Market index for the dsh-web-chat right-sidebar chat panel bundle.',
    zh: 'dsh-web-chat 右侧栏对话面板 bundle 的市场索引。',
  },
  metadata: {
    categories: { chat: { title: { en: 'Chat', zh: '对话' } } },
    labels: {
      ui: { title: { en: 'UI', zh: '界面' } },
      host: { title: { en: 'Host', zh: 'Host' } },
    },
  },
  plugins: [entry],
}

// 官方校验器验证（失败抛 MarketIndexError，含 JSON 路径）
const validated = parseMarketIndex(index, indexUrl)
const target = marketInstallTarget(entry.name, entry.versions[0])

writeFileSync(path.join(marketDir, 'index.json'), JSON.stringify(index, null, 2) + '\n')
writeFileSync(path.join(marketDir, 'entry.json'), JSON.stringify(entry, null, 2) + '\n')

console.log('✓ parseMarketIndex 校验通过')
console.log('插件数:', validated.plugins.length, '· 版本:', validated.plugins[0].versions.map((v) => v.version).join(', '))
console.log('安装目标:', JSON.stringify(target))
console.log('图标内联字节:', iconSvg.length, '(≤32KiB)')
console.log('已写出 market/index.json 与 market/entry.json')