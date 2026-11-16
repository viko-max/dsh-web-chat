// 个性化回复风格（参考 ChatGPT）：六个维度，全局默认 + 会话覆盖，拼入系统提示。

export type Personalization = {
  tone: string
  warmth: string
  enthusiasm: string
  emoji: string
  visual: string
  structure: string
}

export type PersonalizationKey = keyof Personalization

export const defaultPersonalization: Personalization = {
  tone: 'default',
  warmth: 'default',
  enthusiasm: 'default',
  emoji: 'default',
  visual: 'default',
  structure: 'default',
}

export const personalizationKeys: PersonalizationKey[] = ['tone', 'warmth', 'enthusiasm', 'emoji', 'visual', 'structure']

/** 每个维度的可选值（label 为 i18n key） */
export const personalizationOptions: Record<PersonalizationKey, { value: string; label: string }[]> = {
  tone: [
    { value: 'default', label: 'persOptDefault' },
    { value: 'professional', label: 'persOptProfessional' },
    { value: 'casual', label: 'persOptCasual' },
    { value: 'witty', label: 'persOptWitty' },
  ],
  warmth: [
    { value: 'default', label: 'persOptDefault' },
    { value: 'more', label: 'persOptMore' },
    { value: 'less', label: 'persOptLess' },
  ],
  enthusiasm: [
    { value: 'default', label: 'persOptDefault' },
    { value: 'more', label: 'persOptMore' },
    { value: 'less', label: 'persOptLess' },
  ],
  emoji: [
    { value: 'default', label: 'persOptDefault' },
    { value: 'more', label: 'persOptMore' },
    { value: 'less', label: 'persOptLess' },
    { value: 'none', label: 'persOptNone' },
  ],
  visual: [
    { value: 'default', label: 'persOptDefault' },
    { value: 'more', label: 'persOptMore' },
    { value: 'less', label: 'persOptLess' },
  ],
  structure: [
    { value: 'default', label: 'persOptDefault' },
    { value: 'more', label: 'persOptMore' },
    { value: 'less', label: 'persOptLess' },
  ],
}

const instructions: Record<PersonalizationKey, Record<string, string>> = {
  tone: {
    professional: '语气专业、严谨、客观。',
    casual: '语气轻松、口语化、像朋友聊天。',
    witty: '语气风趣幽默，可适当俏皮。',
  },
  warmth: {
    more: '更亲切体贴，多表达关心与共情。',
    less: '更克制疏离，就事论事，少寒暄。',
  },
  enthusiasm: {
    more: '更热情积极，富有感染力。',
    less: '更平和冷静，避免夸张情绪。',
  },
  emoji: {
    more: '适当多用表情符号点缀。',
    less: '少用表情符号。',
    none: '不要使用任何表情符号。',
  },
  visual: {
    more: '多用可视化与结构化呈现（表格、图示、分点），让回答更直观。',
    less: '以连贯 prose 为主，少用图表与交互元素。',
  },
  structure: {
    more: '多用标题、分节与列表组织内容。',
    less: '少用标题和列表，多用自然段落。',
  },
}

/** 合并全局与会话覆盖（会话优先） */
export const mergePersonalization = (
  global: Personalization,
  session?: Partial<Personalization> | null
): Personalization => ({ ...global, ...(session ?? {}) })

/** 生成拼入系统提示的个性化指令（仅非默认项） */
export const buildPersonalizationPrompt = (p: Personalization): string => {
  const parts: string[] = []
  for (const key of personalizationKeys) {
    const instruction = instructions[key][p[key]]
    if (instruction) parts.push(instruction)
  }
  if (!parts.length) return ''
  return '\n\n【回复风格要求】' + parts.join('')
}

export const isDefaultPersonalization = (p: Personalization): boolean =>
  personalizationKeys.every((key) => p[key] === 'default')