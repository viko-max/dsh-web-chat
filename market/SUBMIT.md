# DSH 插件市场提交材料 · dsh-web-chat

本目录含经官方校验器 `@deepseek-ai/dsh-plugin-market-index@0.2.2-rc.3` 验证（`parseMarketIndex` 通过）的市场索引材料。

## 材料清单

| 文件 | 用途 |
| --- | --- |
| `index.json` | 完整的 format-1 市场索引文档（含 dsh-web-chat 一个插件），可直接托管为一个索引源 |
| `entry.json` | 单个插件条目，用于合并进已有的社区/官方索引 |
| `build-index.mjs` | 重新生成并校验索引（`node market/build-index.mjs`，复用 `locale/` 描述与内联图标） |

- 插件名：`dsh-web-chat` · 版本：`0.6.0` · 兼容：`engines.dsh = 0.2.2-rc.3`
- 安装目标（npm 渠道）：`dsh-web-chat@0.6.0`
- 图标：内联 data URL（342 字节 SVG，≤32KiB），索引自包含，无外部依赖
- 标题/描述：中英文（`localizedText`，含 `en`）

## 渠道 A：发布到 npm（推荐，标准做法）

索引条目默认 `source.type = "npm"`（npmjs registry）。需先把 bundle 发布到 npm：

```bash
npm login                      # 登录你的 npm 账号（当前机器未登录）
node pack.mjs                  # 生成 dist-package/package（含 lib/demo/locale/icon/docs/清单）
npm publish dist-package/package --access public
```

- 包名 `dsh-web-chat` 若已被占用，改用 scoped 名（如 `@viko-max/dsh-web-chat`）：同步修改 `pack.mjs` 的 `manifest.name` 与 `market/build-index.mjs` 的 `entry.name`，重新生成索引。
- 发布后 `dsh-web-chat@0.6.0` 即可被市场安装；详情页经 npm CDN（jsdelivr/unpkg/npmmirror）读取 `locale` 的 `meta.detail`。

## 渠道 B：仅用 GitHub（git 提交源，无需 npm）

若不想发 npm，可把构建好的 bundle 提交进仓库，用 git 源安装：

1. `node pack.mjs` 后，把 `dist-package/package/` 复制为仓库内的 `bundle/` 目录并提交、推送。
2. 取该提交 SHA，将条目 `versions[0].source` 改为：
   ```json
   { "type": "git", "url": "https://github.com/viko-max/dsh-web-chat", "commit": "<40位SHA>", "path": "bundle" }
   ```
3. 安装目标变为 `git+https://github.com/viko-max/dsh-web-chat.git#<SHA>&path:/bundle`。
4. 重新 `node market/build-index.mjs` 校验（需先把脚本的 source 改为 git）。

注意：git 渠道会把约 19MB 构建产物（含桌宠素材）提交进仓库；npm 渠道则保持源码仓库干净。

## 托管索引源

市场读取用户配置的索引 URL（http/https，无凭据/片段）。两种方式：

- **自托管**：把 `market/index.json` 提交进本仓库，raw 地址即可作为索引源：
  `https://raw.githubusercontent.com/viko-max/dsh-web-chat/main/market/index.json`
- **投稿到社区/官方索引**：把 `entry.json` 合并进目标索引仓库的 `plugins` 数组（注意 `metadata.category/labels` 须在该索引的 `metadata` 中声明），按其贡献流程提 PR。

## 在 DSH 中验证

1. 确保插件包已发布（渠道 A 或 B），索引 URL 可访问。
2. DSH 设置 → 插件市场（plugin-market）`indexes` 添加上述索引 URL（需启用 `plugin-market` bundle；默认 shipped profile 关闭）。
3. Web「插件 → Discover」浏览/搜索 `dsh-web-chat`，查看中英文标题/描述/图标/详情页，安装并启用。
4. 安装走 `pluginManager.installBundle`，兼容性与安装状态由市场按 `engines.dsh` 计算。

## 已验证 / 待验证

- ✅ `parseMarketIndex(index, indexUrl)` 通过；`marketInstallTarget` 返回 `dsh-web-chat@0.6.0`。
- ✅ 图标为合法 SVG、内联 ≤32KiB；标题/描述含 en+zh。
- ⏳ npm 包尚未发布（需 `npm login`）；索引 URL 尚未托管；Discover 实际渲染未在本环境目视确认。