import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { defaultPersonalization, type Personalization } from './personalization.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 桌宠标识；hidden 为隐藏（角色与素材见 components/pet/petAssets.ts） */
export type PetId = 'hidden' | 'blue-chibi' | 'blue-full' | 'orange' | 'harmony' | 'bucket'

export type ReplyStyle = { id: string; text: string }

/**
 * 本机设置，统一存 localStorage 的 dsh-web-chat:preferences（与原插件格式兼容）。
 * 面板模式下 API Key 由 Harness 凭据存储托管，本地只留占位值。
 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  readAloud: boolean
  pet: PetId
  petSize: number
  petPosition: { x: number; y: number }
  replyStyle: ReplyStyle
  sessionStyles: Record<string, ReplyStyle>
  /** 长上下文自动压缩 */
  autoCompact: boolean
  compactThreshold: number
  /** 显示模型思考过程 */
  showThinking: boolean
  /** 个性化回复风格（全局默认） */
  personalization: Personalization
  sessionPersonalization: Record<string, Personalization>
  /** 各图像服务偏好的生图模型（动态下拉所选） */
  imageModelPrefs: Record<string, string>
  /** 自定义背景效果 */
  bgEffect: 'none' | 'frosted' | 'acrylic' | 'transparent'
  bgBlur: number
  bgOpacity: number
  bgImageId: string | null
  /** 侧边栏排序与密度 */
  siderSort: 'updated' | 'created'
  siderCompact: boolean
}

const STORAGE_KEY = 'dsh-web-chat:preferences'

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const defaults = (): Settings => ({
  apiKey: __PANEL_MODE__ ? 'host-managed' : null,
  locale: isChineseBrowser() ? 'zh-CN' : 'en-US',
  themePreference: 'system',
  location: null,
  ttsVoice: 'stella',
  thinking: false,
  search: false,
  siderCollapsed: false,
  readAloud: false,
  pet: 'blue-chibi',
  petSize: 104,
  petPosition: { x: 1, y: 0 },
  replyStyle: { id: 'default', text: '' },
  sessionStyles: {},
  autoCompact: true,
  compactThreshold: 24000,
  showThinking: true,
  personalization: defaultPersonalization,
  sessionPersonalization: {},
  imageModelPrefs: {},
  bgEffect: 'none',
  bgBlur: 18,
  bgOpacity: 0.72,
  bgImageId: null,
  siderSort: 'updated',
  siderCompact: false,
})

const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback

const petIds: PetId[] = ['hidden', 'blue-chibi', 'blue-full', 'orange', 'harmony', 'bucket']

/** 读取并规范化持久化设置；未知字段忽略，损坏数据回退默认 */
const load = (): Settings => {
  const base = defaults()
  let saved: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof parsed === 'object' && parsed !== null) saved = parsed as Record<string, unknown>
  } catch {
    return base
  }
  const pick = <K extends keyof Settings>(key: K, validate: (value: unknown) => boolean): Settings[K] =>
    validate(saved[key]) ? (saved[key] as Settings[K]) : base[key]
  return {
    apiKey: __PANEL_MODE__ ? 'host-managed' : pick('apiKey', (v) => typeof v === 'string' || v === null),
    locale: pick('locale', (v) => v === 'zh-CN' || v === 'en-US'),
    themePreference: pick('themePreference', (v) => v === 'light' || v === 'dark'),
    location: (() => {
      try {
        const location = normalizeLocation(saved.location)
        if (!location) return null
        return isChineseBrowser()
          ? location.region === 'CN' && location.province
            ? location
            : null
          : { region: location.region }
      } catch {
        return null
      }
    })(),
    ttsVoice: pick('ttsVoice', (v) => v === 'stella' || v === 'tide'),
    thinking: pick('thinking', (v) => typeof v === 'boolean'),
    search: pick('search', (v) => typeof v === 'boolean'),
    siderCollapsed: pick('siderCollapsed', (v) => typeof v === 'boolean'),
    readAloud: pick('readAloud', (v) => typeof v === 'boolean'),
    pet: pick('pet', (v) => petIds.includes(v as PetId)),
    petSize: typeof saved.petSize === 'number' && saved.petSize >= 64 && saved.petSize <= 154 ? saved.petSize : base.petSize,
    petPosition: {
      x: clamp01((saved.petPosition as { x?: unknown })?.x, 1),
      y: clamp01((saved.petPosition as { y?: unknown })?.y, 0),
    },
    replyStyle:
      typeof saved.replyStyle === 'object' && saved.replyStyle !== null &&
      typeof (saved.replyStyle as ReplyStyle).id === 'string'
        ? { id: (saved.replyStyle as ReplyStyle).id, text: String((saved.replyStyle as ReplyStyle).text ?? '') }
        : base.replyStyle,
    sessionStyles:
      typeof saved.sessionStyles === 'object' && saved.sessionStyles !== null
        ? (saved.sessionStyles as Record<string, ReplyStyle>)
        : {},
    autoCompact: pick('autoCompact', (v) => typeof v === 'boolean'),
    compactThreshold:
      typeof saved.compactThreshold === 'number' && saved.compactThreshold >= 4000 && saved.compactThreshold <= 200000
        ? saved.compactThreshold
        : base.compactThreshold,
    siderSort: pick('siderSort', (v) => v === 'updated' || v === 'created'),
    siderCompact: pick('siderCompact', (v) => typeof v === 'boolean'),
    showThinking: pick('showThinking', (v) => typeof v === 'boolean'),
    personalization: { ...base.personalization, ...(typeof saved.personalization === 'object' && saved.personalization !== null ? (saved.personalization as Partial<Personalization>) : {}) },
    sessionPersonalization:
      typeof saved.sessionPersonalization === 'object' && saved.sessionPersonalization !== null
        ? (saved.sessionPersonalization as Record<string, Personalization>)
        : {},
    imageModelPrefs:
      typeof saved.imageModelPrefs === 'object' && saved.imageModelPrefs !== null
        ? (saved.imageModelPrefs as Record<string, string>)
        : {},
    bgEffect: pick('bgEffect', (v) => v === 'frosted' || v === 'acrylic' || v === 'transparent'),
    bgBlur: typeof saved.bgBlur === 'number' && saved.bgBlur >= 0 && saved.bgBlur <= 40 ? saved.bgBlur : base.bgBlur,
    bgOpacity: typeof saved.bgOpacity === 'number' && saved.bgOpacity >= 0.3 && saved.bgOpacity <= 0.95 ? saved.bgOpacity : base.bgOpacity,
    bgImageId: typeof saved.bgImageId === 'string' ? saved.bgImageId : null,
  }
}

const persist = (state: Settings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 存储不可用时只在内存中生效
  }
}

export const useSettings = create<Settings>(() => load())

const update = (partial: Partial<Settings>) => {
  useSettings.setState(partial)
  persist(useSettings.getState())
}

export const setLocale = (locale: Locale) => update({ locale })
export const setLocation = (value: UserLocation | null) => update({ location: normalizeLocation(value) })
export const setThemePreference = (themePreference: ThemePreference) => update({ themePreference })
export const setTtsVoice = (ttsVoice: TtsVoice) => update({ ttsVoice })
export const setApiKey = (apiKey: string | null) => update({ apiKey })
export const setThinking = (thinking: boolean) => update({ thinking })
export const setSearch = (search: boolean) => update({ search })
export const setSiderCollapsed = (siderCollapsed: boolean) => update({ siderCollapsed })
export const setReadAloud = (readAloud: boolean) => update({ readAloud })
export const setPet = (pet: PetId) => update({ pet })
export const setPetSize = (petSize: number) => update({ petSize: Math.min(154, Math.max(64, Math.round(petSize))) })
export const setPetPosition = (petPosition: { x: number; y: number }) =>
  update({ petPosition: { x: clamp01(petPosition.x, 1), y: clamp01(petPosition.y, 0) } })
export const setReplyStyle = (replyStyle: ReplyStyle) => update({ replyStyle })
export const setAutoCompact = (autoCompact: boolean) => update({ autoCompact })
export const setCompactThreshold = (compactThreshold: number) =>
  update({ compactThreshold: Math.min(200000, Math.max(4000, Math.round(compactThreshold))) })
export const setSiderSort = (siderSort: 'updated' | 'created') => update({ siderSort })
export const setSiderCompact = (siderCompact: boolean) => update({ siderCompact })
export const setShowThinking = (showThinking: boolean) => update({ showThinking })
export const setPersonalization = (personalization: Personalization) => update({ personalization })
export const setImageModelPref = (provider: string, model: string) =>
  update({ imageModelPrefs: { ...useSettings.getState().imageModelPrefs, [provider]: model } })
export const setSessionPersonalization = (sessionId: string, value: Personalization | null) => {
  const sessionPersonalization = { ...useSettings.getState().sessionPersonalization }
  if (value) sessionPersonalization[sessionId] = value
  else delete sessionPersonalization[sessionId]
  update({ sessionPersonalization })
}
export const setBgEffect = (bgEffect: 'none' | 'frosted' | 'acrylic' | 'transparent') => update({ bgEffect })
export const setBgBlur = (bgBlur: number) => update({ bgBlur: Math.min(40, Math.max(0, Math.round(bgBlur))) })
export const setBgOpacity = (bgOpacity: number) => update({ bgOpacity: Math.min(0.95, Math.max(0.3, bgOpacity)) })
export const setBgImageId = (bgImageId: string | null) => update({ bgImageId })
export const setSessionStyle = (sessionId: string, style: ReplyStyle | null) => {
  const sessionStyles = { ...useSettings.getState().sessionStyles }
  if (style) sessionStyles[sessionId] = style
  else delete sessionStyles[sessionId]
  update({ sessionStyles })
}