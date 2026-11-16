# DeepSeek Harness 桌面插件 · dsh-web-chat 0.6.0

面向 Windows 上的 DeepSeek Harness Desktop `0.2.2-rc.3`。从桌面版侧栏打开「插件 → 添加插件」，粘贴本地 `.tgz` 的完整路径，安装后选「立即启用」。

- `desktop/dsh-web-chat-0.6.0-desktop.tgz` 是重建版安装包。复用 Harness 设置中的 DeepSeek API Key，并支持自定义第三方对话服务商与图像服务。
- `desktop/dsh-web-chat-0.6.0-desktop-offline.tgz` 是离线验收包：使用本机模拟服务，无需任何 API Key 即可体验全部界面与流程（聊天/续聊/工具往返/语音/OCR/应用连接）。两个包同名，切换时先移除旧包。
- 桌面里已装旧版时，先在插件管理中移除原包，再导入本安装包；或运行仓库根目录的 `sync-desktop.ps1`（在用户自己的终端中执行）。

打开右侧栏，在「开始」点「DeepSeek 对话」。聊天、历史列表和设置都在这个面板里。

## 0.6.0 新特性（第三轮反馈）

1. **品牌名**改为「创造你想要的」；去掉输入框聚焦时的蓝色横线（焦点环只保留按钮/链接）。
2. **生图改为 ChatGPT 式**：普通聊天里说"画一张…"，模型自行调用 `generate_image` 工具、inline 出图，无开关无工作台；**图像库移到侧栏「开启新对话」下方**。
3. **思考过程**升级为可折叠卡片：图标 + 流式"内心戏"轮播 + 用时，设置可开关显示。
4. **个性化**（设置新页签 + 会话右上角覆盖）：基础风格语气 / 亲切 / 热情 / 表情符号 / 可视化 / 标题列表 六项，拼入系统提示。
5. **自定义背景**：上传背景图 + 毛玻璃/亚克力/透明效果 + 模糊/不透明度滑杆；对话区自动垫可读面板，默认纯色。
6. **导出分享**：对话导出为 **PNG 长图**（html-to-image）/ Markdown / 纯文本；Markdown/LaTeX/代码排版精修。
7. **桌宠**接入用户提供的 20 动作素材（blue-chibi/blue-full/orange/harmony/bucket 五角色，loop/event 映射状态机）。
8. **导入对话**真实回归测试（`test/import-flow.mjs`，校验 v3 归档解析/消息树/图片；可放入 `test/fixtures/*.zip` 用真实数据验证）。

## 0.5.0 新特性（本轮反馈）

1. **图像服务商单一入口 + 模型下拉**：混元不再拆分 3.0/3.5，合并为「腾讯混元 / TokenHub」一个入口，按所选模型自动路由协议；生图对话框可**动态拉取各提供商最新图像模型**（TokenHub/硅基流动/千问/火山，失败回退默认）。
2. **ChatGPT 式生图体验**：生成的图作为**聊天内图像卡片**（悬停编辑/下载、点击看大图），配独立**大图查看器**与**「我的图库」**（搜索/编辑/下载/删除）。
3. 标题改为「**创造你想要的**」。
4. **连接器品牌图标** + QQ 邮箱/QQ 机器人的**跳转链接与小字说明**（GitHub/Gmail/Outlook 亦附配置入口）。
5. **回复统计**：每条回复显示输入/输出 token、缓存命中率、TPS；新增**长上下文自动压缩**（设置可调开关与阈值，仅压缩发送内容，本地历史不变）。
6. **桌宠设计提示词**：见 `docs/pet-prompts.md`（参考 dsh-pet 绿幕→透明 webm 管线，用户自行生图后交回）。
7. **模型名柔化**为轻量内联文本；新增**对话时间轴**（右侧刻度，悬停看时间/摘要，点击跳转）；**左侧栏改为 ChatGPT 式**（搜索 + 「最近」排序/显示菜单 + 扁平列表）。

## 0.4.0 新特性

1. **对话服务商与图像服务彻底分离**。「设置 → 对话服务商」可添加 OpenAI 兼容 / Anthropic 兼容自定义端点（Base URL + 独立 API Key + 模型列表，含工具/视觉/思考能力标记），另有 Spark X2.6 快捷 Key 卡片；「设置 → 图像服务」保留千问/火山/硅基流动/混元四家预设，新增**混元 3.5 预设**（v35-generation，Chat/Messages 协议，支持参考图编辑，与混元 3.0 共享 Key），并支持自定义端点。两套凭据完全隔离，均存于 Harness 凭据存储。
2. **诊断按钮**。每个对话服务商可一键测试连接、测试工具调用往返（内置 dswc_echo 工具）；每个自定义图像服务可测试生图。结果展示延迟、token 与错误详情。
3. **模型选择**。欢迎页与会话内均可切换模型：DeepSeek 官方、Harness 已配置模型、Spark X2.6、自定义服务商。会话内选择只影响该会话。
4. **应用工具调用循环**。连接 GitHub/Gmail/Outlook/QQ 邮箱后，模型可在对话中调用其工具；Gmail 数据先预览，点「发送并继续」才交给模型。工具调用过程在回复时间线可见。
5. **UI 精致化**。ChatGPT 式浅色（纯白画布、近黑正文、发丝边框、单色主按钮）与 Grok 式深色（近黑层次、白色主按钮），跟随系统；消息入场动效、细滚动条、统一焦点环。
6. **桌宠增强**。默认显示，顶栏鲸鱼图标一键开关，首次使用有引导气泡。单击/双击台词气泡、悬停注视、拖拽倾斜 + 落地回弹、随机待机小动作；思考/朗读/完成/错误/中断都有反应。
7. **自动化与 Agent 移交保留**。定时任务后台执行、结果写入目标对话；网页回复可一键交给 Harness 原生会话。

## 功能一览

- 多会话、分支、编辑提问、重新生成、续写；流式回复、深度思考、智能搜索、引用来源。
- 附件上传/粘贴/拖拽，语音输入与朗读，OCR 提取文字（先预览后插入草稿）。
- 生图工作台：创建（可选参考图）、图像库、编辑派生、下载、删除；图像按来源会话保存，删除会话同步清理。
- 应用连接：GitHub 设备码授权、Gmail/Outlook OAuth、QQ 邮箱 IMAP、QQ 机器人收件。
- 历史导入导出（ZIP）、浅色/深色/跟随系统、中英双语。

## 数据与凭据

- 面板会话写入独立的 IndexedDB；偏好存 localStorage（`dsh-web-chat:preferences`，与 0.3.x 兼容）。
- 所有 API Key 存 Harness 凭据存储，浏览器端不持有密钥；自定义对话凭据 `DSWC_CHAT_<id>`、图像凭据 `DSWC_IMAGE_<id>`。
- Gmail 原始数据只随确认后的本轮请求发送。

## 开发

```
official-demo/   面板源码（fork 自官方 deepseek-ai/chat-demo，MIT）
host-src/        Host 插件源码（esbuild 打包）
client/          DSH web 客户端入口
test/            冒烟与协议测试（mock 服务，本机回环）
pack.mjs         组装并打包 tgz
sync-desktop.ps1 桌面 profile 同步脚本（用户终端执行）
```

- `node test/smoke.mjs`：重建等价冒烟（对比 0.3.0 原版行为，22 项）。
- `node test/providers.mjs`：服务商/图像/工具循环协议测试（22 项）。
- `node test/offline-flow.mjs`：离线全流程验收（需先 `node host-src/build.mjs --offline`；消息/续聊/工具往返/语音/OCR/文件/应用/自动化，23 项）。
- `node test/credentials.mjs`：凭据来源隔离 + 生图模型传递（14 项）。
- `node test/automation.mjs`：自动化路由 + 取消/投递竞态（11 项）。
- `node test/usage.mjs`：用量统计单次/累计 + 缓存/TPS 口径（8 项）。
- `node test/attachments.mjs`：附件按协议准备 + 能力校验（12 项）。
- `node test/history-images.mjs`：生成图 ZIP 往返 + 派生关系 + 损坏路径（13 项）。
- `node test/import-flow.mjs`：导入解析回归（可放入 `test/fixtures/*.zip` 用真实数据验证，11 项）。
- `node test/real-api.mjs`：第三方真实 API 实测，凭据从工作区 `.env` 读取（git 忽略），报告写入 `docs/test-reports/`。
- `node pack.mjs`：构建 + 打包到 `desktop/`；`--offline` 打离线验收包；`--node-tar` 在无 python 环境用内置 Node tar 兜底。构建工具按 `DSWC_PNPM_PATH`/`DSWC_PYTHON_PATH` 或运行时同级依赖/PATH 发现，不硬编码用户目录。

本轮八项缺陷修复与逐项验证见 [docs/fixes-0.6.0.md](docs/fixes-0.6.0.md)。

上游：[官方 Chat Demo 源码](https://github.com/deepseek-ai/chat-demo) · [官方桌面版说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/apps/desktop/README.md)

## 许可证

MIT © 2026 meiko。本项目 fork 自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT，见 `LICENSE-chat-demo`），并打包 [fflate](https://github.com/101arrowz/fflate)（MIT，见 `LICENSE-fflate`）。桌宠素材由用户提供。

## 投稿 / 发布

- 安装包同时是 DSH bundle：`package.json` 声明 `dsh.bundle.patch`，并导出 `./icon`、`./locale/*.json`（中英文 `meta.title/description/detail`）与单图详情页 `docs/DETAIL.md`。
- 构建：`node pack.mjs`（正式）/ `node pack.mjs --offline`（离线）；产物在 `desktop/`，作为 GitHub Release 资产上传。
- 发布到 GitHub 后，将 bundle 提交到 DSH 插件市场索引（Discover 页来源）即可被检索安装；`repository` 字段请替换为你的实际仓库地址。