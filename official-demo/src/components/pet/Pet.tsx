import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useChatStore } from '../../services/chat/store.js'
import { useReadAloud } from '../../services/speech/readAloud.js'
import { setPetPosition, useSettings } from '../../services/settings.js'
import { PetVideo } from './PetVideo.js'
import {
  isPetCharacter,
  petCharacters,
  randomPetEvent,
  resolvePetAction,
  type PetActionMode,
  type PetCharacter,
  type PetMotion,
} from './petAssets.js'
import styles from './Pet.module.css'

const lines = {
  click: ['嗨！', '戳我干嘛~', '鲸鱼摆尾！', '今天也要加油鸭'],
  double: ['嘿嘿，好痒！', '双击成就达成 ✦', '再来一下？'],
  done: ['搞定啦！', '完成！✦', '这波回答不错吧'],
  error: ['呜…出错了', '别急，再试一次'],
  stopped: ['停下来了', '随时继续~'],
  idle: ['~♪', '鲸鱼呼吸中', '…'],
}

const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)]
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const GUIDE_KEY = 'dsh-web-chat:pet-guide-seen'

/**
 * 桌宠：待机 / 思考 / 朗读 / 完成 / 点击 / 出错 状态，映射到素材动作。
 * 单击台词、双击特殊反应、悬停注视、拖拽倾斜 + 落地回弹、随机待机事件与气泡。
 */
export const Pet = () => {
  const pet = useSettings((state) => state.pet)
  const petSize = useSettings((state) => state.petSize)
  const petPosition = useSettings((state) => state.petPosition)
  const thinking = useChatStore(
    (state) => state.activeId !== null && Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const lastMessage = useChatStore((state) =>
    state.activeId ? state.sessionCache[state.activeId]?.messages.at(-1) : undefined
  )
  const lastDone = lastMessage?.role === 'assistant' && lastMessage.status === 'done'
  const lastError = lastMessage?.role === 'assistant' && lastMessage.status === 'error'
  const lastStopped = lastMessage?.role === 'assistant' && lastMessage.status === 'stopped'
  const reading = useReadAloud((state) => state.status === 'playing')
  const [override, setOverride] = useState<'done' | 'reaction' | 'error' | null>(null)
  const [eventAction, setEventAction] = useState<{ action: string; mode: PetActionMode } | null>(null)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const [bubble, setBubble] = useState('')
  const [hovered, setHovered] = useState(false)
  const [dragTilt, setDragTilt] = useState(0)
  const [landed, setLanded] = useState(false)
  const [guide, setGuide] = useState(false)
  const drag = useRef<{ x: number; y: number; left: number; top: number; changed: boolean } | null>(null)
  const previous = useRef({ active: activeId, thinking })
  const reactedError = useRef<string | null>(null)
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = (text: string) => {
    setBubble(text)
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
    bubbleTimer.current = setTimeout(() => setBubble(''), 2600)
  }

  useEffect(() => {
    if (pet === 'hidden') return undefined
    try {
      if (!localStorage.getItem(GUIDE_KEY)) {
        setGuide(true)
        const timer = setTimeout(() => {
          setGuide(false)
          localStorage.setItem(GUIDE_KEY, '1')
        }, 8000)
        return () => clearTimeout(timer)
      }
    } catch {
      // 存储不可用时不显示引导
    }
    return undefined
  }, [pet])

  useEffect(() => {
    if (previous.current.active === activeId && previous.current.thinking && !thinking) {
      if (lastDone) {
        setOverride('done')
        say(pick(lines.done))
      } else if (lastError) {
        setOverride('error')
        say(pick(lines.error))
      } else if (lastStopped) {
        say(pick(lines.stopped))
      }
    } else if (previous.current.active !== activeId || thinking) {
      setOverride(null)
    }
    previous.current = { active: activeId, thinking }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, thinking, lastDone, lastError, lastStopped])

  useEffect(() => {
    if (lastError && lastMessage && reactedError.current !== lastMessage.id && !thinking) {
      reactedError.current = lastMessage.id
      setOverride('error')
      say(pick(lines.error))
    }
  }, [lastError, lastMessage, thinking])

  useEffect(() => {
    if (!override) return
    const timer = setTimeout(() => setOverride(null), 2200)
    return () => clearTimeout(timer)
  }, [override])

  const motion: PetMotion = override ?? (reading ? 'reading' : thinking ? 'thinking' : 'idle')
  const character: PetCharacter = isPetCharacter(pet) ? pet : 'blue-chibi'
  const baseAction = resolvePetAction(character, motion)
  const currentAction = eventAction ?? baseAction

  // 随机待机小动作：偶尔播放一个事件动画 + 台词
  useEffect(() => {
    if (motion !== 'idle' || pet === 'hidden' || !isPetCharacter(pet)) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        if (Math.random() < 0.7) {
          setEventAction(randomPetEvent(pet))
          if (Math.random() < 0.5) say(pick(lines.idle))
        }
        schedule()
      }, 8000 + Math.random() * 12000)
    }
    schedule()
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion, pet])

  useEffect(() => () => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
  }, [])

  if (pet === 'hidden' || !isPetCharacter(pet)) return null

  const position = dragPosition ?? petPosition
  const name = petCharacters.find((c) => c.id === pet)?.name ?? pet

  return (
    <div className={styles.track} style={{ '--pet-size': `${petSize}px` } as CSSProperties}>
      <button
        type="button"
        className={styles.pet}
        title={name}
        aria-label={name}
        data-panel-pet
        data-motion={motion}
        style={{
          left: `${100 * position.x}%`,
          top: `${100 * position.y}%`,
          transform: `translate(${-(100 * position.x)}%, ${-(100 * position.y)}%)`,
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const rect = event.currentTarget.getBoundingClientRect()
          drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, changed: false }
          event.currentTarget.setPointerCapture(event.pointerId)
          if (guide) {
            setGuide(false)
            try {
              localStorage.setItem(GUIDE_KEY, '1')
            } catch {}
          }
        }}
        onPointerMove={(event) => {
          const state = drag.current
          if (!state) return
          const dx = event.clientX - state.x
          const dy = event.clientY - state.y
          if (!state.changed && Math.hypot(dx, dy) < 5) return
          state.changed = true
          setDragTilt(Math.max(-14, Math.min(14, dx * 0.08)))
          const element = event.currentTarget
          const parent = element.parentElement
          if (!parent) return
          const rect = parent.getBoundingClientRect()
          setDragPosition({
            x: clamp01((state.left + dx - rect.left) / Math.max(1, rect.width - element.offsetWidth)),
            y: clamp01((state.top + dy - rect.top) / Math.max(1, rect.height - element.offsetHeight)),
          })
        }}
        onPointerUp={() => {
          if (drag.current?.changed) {
            if (dragPosition) setPetPosition(dragPosition)
            setLanded(true)
            setTimeout(() => setLanded(false), 450)
          }
          setDragTilt(0)
          setDragPosition(null)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDragTilt(0)
          setDragPosition(null)
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={(event) => {
          if (event.detail === 0 || drag.current?.changed) {
            drag.current = null
            return
          }
          setEventAction(null)
          setOverride('reaction')
          say(event.detail >= 2 ? pick(lines.double) : pick(lines.click))
          drag.current = null
        }}
      >
        {bubble ? <span className={styles.bubble}>{bubble}</span> : null}
        {guide ? <span className={styles.guide}>点我试试 ✦ 顶栏可隐藏</span> : null}
        <span
          className={[
            styles.media,
            hovered && !drag.current?.changed ? styles.curious : '',
            landed ? styles.landed : '',
          ].join(' ')}
          style={dragTilt ? { transform: `rotate(${dragTilt}deg)` } : undefined}
        >
          <PetVideo
            character={character}
            action={currentAction.action}
            mode={currentAction.mode}
            onEnd={() => {
              setOverride(null)
              setEventAction(null)
            }}
          />
        </span>
      </button>
    </div>
  )
}