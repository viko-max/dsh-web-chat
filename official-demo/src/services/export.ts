// 对话导出分享：Markdown / 纯文本 / PNG 长图（html-to-image）。
import { toPng } from 'html-to-image'
import { getVisibleMessages } from './chat/branches.js'
import type { AssistantMessage, Session, UserMessage } from './chat/types.js'

const assistantText = (message: AssistantMessage): string =>
  message.blocks.map((block) => (block.type === 'text' && !block.isTemplate ? block.text : '')).join('')

const assistantThinking = (message: AssistantMessage): string =>
  message.blocks.map((block) => (block.type === 'thinking' ? block.thinking : '')).join('')

const imageCount = (message: AssistantMessage): number =>
  message.blocks.filter((block) => block.type === 'generated_image').length

const stamp = () => new Date().toISOString().slice(0, 10)

const triggerDownload = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

const safeName = (session: Session) =>
  (session.title || '对话').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

/** 导出 Markdown */
export const exportMarkdown = (session: Session, includeThinking = false): void => {
  const lines: string[] = [`# ${session.title || '对话'}`, '', `> 导出时间：${new Date().toLocaleString()}`, '']
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      const user = message as UserMessage
      lines.push('## 🧑 用户', '', user.content || '（附件）', '')
      if (user.files.length) lines.push(`_附件：${user.files.map((f) => f.name).join('、')}_`, '')
    } else {
      const reply = message as AssistantMessage
      lines.push('## 🤖 助手', '')
      if (includeThinking) {
        const thinking = assistantThinking(reply)
        if (thinking.trim()) lines.push('<details><summary>思考过程</summary>', '', thinking, '', '</details>', '')
      }
      const text = assistantText(reply)
      if (text.trim()) lines.push(text, '')
      const images = imageCount(reply)
      if (images) lines.push(`_（含 ${images} 张生成图像，见图片导出）_`, '')
    }
  }
  triggerDownload(`${safeName(session)}-${stamp()}.md`, new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }))
}

/** 导出纯文本 */
export const exportText = (session: Session): void => {
  const lines: string[] = [`${session.title || '对话'}`, `导出时间：${new Date().toLocaleString()}`, '']
  for (const message of getVisibleMessages(session)) {
    if (message.role === 'user') {
      lines.push('【用户】', (message as UserMessage).content || '（附件）', '')
    } else {
      const text = assistantText(message as AssistantMessage)
      if (text.trim()) lines.push('【助手】', text, '')
    }
  }
  triggerDownload(`${safeName(session)}-${stamp()}.txt`, new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }))
}

/** 导出 PNG 长图：捕获对话渲染节点 */
export const exportPng = async (node: HTMLElement, backgroundColor: string): Promise<void> => {
  const dataUrl = await toPng(node, {
    backgroundColor,
    pixelRatio: 2,
    cacheBust: true,
    style: { transform: 'none', maxHeight: 'none', overflow: 'visible' },
  })
  const blob = await (await fetch(dataUrl)).blob()
  triggerDownload(`${safeNameFromNode(node)}-${stamp()}.png`, blob)
}

const safeNameFromNode = (node: HTMLElement) =>
  (node.getAttribute('data-export-title') || '对话').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)