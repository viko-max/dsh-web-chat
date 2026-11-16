// 项②附件协议回归入口：纯函数附件块构建 + 协议消息转换。
export { buildAttachmentBlocks, attachmentSupportError, parseDataUrl } from '../official-demo/src/services/chat/attachmentBlocks.js'
export { toOpenaiMessages, toAnthropicMessages } from '../host-src/src/panel-adapters.js'