// 绘画/生图意图识别：命中时客户端直接调图像服务出图，不依赖模型是否调用工具。
// 纯函数，便于内存回归。保守匹配，避免把普通聊天误判为生图。

/** 识别明确的绘画/生图意图 */
export const isDrawingIntent = (text: string): boolean => {
  const t = text.trim()
  if (!t) return false
  // 动词 + 图类宾语：画一张图 / 生成图片 / 设计海报 / 出个头像 …
  if (/(画|绘|生成|创作|设计|做|出)一?[张幅个套]?(图|图片|图像|插画|插图|海报|头像|壁纸|封面|漫画|照片|画作)/.test(t)) return true
  // 以"画"开头的祈使句（排除"画面"这类名词）
  if (/^(请|帮我|给我|麻烦)?画(?!面)/.test(t)) return true
  // 英文 draw / generate an image / illustration of …
  if (/\b(draw|sketch|paint|generate\s+(an?\s+)?(image|picture|illustration|poster|art)|create\s+(an?\s+)?(image|picture|illustration)|illustration\s+of)\b/i.test(t)) return true
  return false
}