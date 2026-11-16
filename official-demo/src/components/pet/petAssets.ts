// 桌宠素材清单与状态映射（素材来自用户提供的 deskpet_20_complete.zip）
// 每个角色含若干 loop（循环）/ event（一次性）动作；状态机映射到具体动作。
import { API_ORIGIN, PANEL_MODE } from '../../services/api/client.js'

export type PetCharacter = 'blue-chibi' | 'blue-full' | 'orange' | 'harmony' | 'bucket'
export type PetMotion = 'idle' | 'thinking' | 'reading' | 'done' | 'reaction' | 'error'
export type PetActionMode = 'loop' | 'event'

const assetBase = PANEL_MODE ? `${API_ORIGIN}?asset=static/pets/` : 'static/pets/'

export const petAssetUrl = (character: PetCharacter, action: string, ext: 'webm' | 'gif' = 'webm') =>
  `${assetBase}${character}-${action}.${ext}`

export const petCharacters: { id: PetCharacter; name: string }[] = [
  { id: 'blue-chibi', name: '蓝发鲸鱼娘 · Q 版' },
  { id: 'blue-full', name: '蓝发鲸鱼娘 · 全身' },
  { id: 'orange', name: '橙发读书娘' },
  { id: 'harmony', name: '黑发 HarmonyOS' },
  { id: 'bucket', name: '炸鸡桶小伙伴' },
]

type ActionDef = { action: string; mode: PetActionMode }

// 与 manifest.json 一致
const catalog: Record<PetCharacter, ActionDef[]> = {
  'blue-full': [
    { action: 'stretch', mode: 'event' },
    { action: 'bubble', mode: 'event' },
    { action: 'skirt', mode: 'loop' },
    { action: 'lift', mode: 'event' },
  ],
  'blue-chibi': [
    { action: 'drowsy', mode: 'loop' },
    { action: 'listen', mode: 'loop' },
    { action: 'puff', mode: 'event' },
    { action: 'startled', mode: 'event' },
  ],
  bucket: [
    { action: 'steal-fries', mode: 'event' },
    { action: 'sniff', mode: 'loop' },
    { action: 'offer-chicken', mode: 'event' },
    { action: 'wobble', mode: 'event' },
  ],
  orange: [
    { action: 'book-read', mode: 'loop' },
    { action: 'book-dust', mode: 'event' },
    { action: 'bookmark', mode: 'event' },
    { action: 'stomp', mode: 'loop' },
  ],
  harmony: [
    { action: 'notification', mode: 'event' },
    { action: 'giggle', mode: 'event' },
    { action: 'reading', mode: 'loop' },
    { action: 'shrug', mode: 'event' },
  ],
}

const loops = (character: PetCharacter) => catalog[character].filter((a) => a.mode === 'loop')
const events = (character: PetCharacter) => catalog[character].filter((a) => a.mode === 'event')

// 状态 → 动作（优先语义贴近者；缺省回退到该角色的循环/事件池）
const statePreference: Record<PetMotion, Partial<Record<PetCharacter, string>>> = {
  idle: { 'blue-chibi': 'listen', orange: 'stomp', harmony: 'reading', bucket: 'sniff', 'blue-full': 'skirt' },
  thinking: { 'blue-chibi': 'drowsy', orange: 'book-read', harmony: 'reading', bucket: 'sniff', 'blue-full': 'skirt' },
  reading: { harmony: 'reading', orange: 'book-read', 'blue-chibi': 'listen', bucket: 'sniff', 'blue-full': 'skirt' },
  done: { 'blue-full': 'lift', 'blue-chibi': 'puff', bucket: 'offer-chicken', orange: 'bookmark', harmony: 'giggle' },
  reaction: { 'blue-full': 'bubble', 'blue-chibi': 'startled', bucket: 'wobble', orange: 'book-dust', harmony: 'shrug' },
  error: { 'blue-chibi': 'startled', harmony: 'shrug', bucket: 'wobble', orange: 'book-dust', 'blue-full': 'stretch' },
}

/** 解析某状态对应的动作与播放模式 */
export const resolvePetAction = (character: PetCharacter, motion: PetMotion): ActionDef => {
  const preferred = statePreference[motion]?.[character]
  const found = catalog[character].find((a) => a.action === preferred)
  if (found) return found
  const pool = motion === 'idle' || motion === 'thinking' || motion === 'reading' ? loops(character) : events(character)
  return pool[0] ?? catalog[character][0]
}

/** 随机待机小动作（从事件池抽取） */
export const randomPetEvent = (character: PetCharacter): ActionDef => {
  const pool = events(character)
  return pool[Math.floor(Math.random() * pool.length)] ?? catalog[character][0]
}

/** 静态首帧用的代表动作（减少动态效果时显示） */
export const petPosterAction = (character: PetCharacter): string => loops(character)[0]?.action ?? catalog[character][0].action

export const isPetCharacter = (value: unknown): value is PetCharacter =>
  typeof value === 'string' && Object.hasOwn(catalog, value)