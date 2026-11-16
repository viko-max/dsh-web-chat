import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, IconThinkOutline16 } from '../base/icons.js'
import { useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { getThinkingSeconds } from '../../services/chat/reply.js'
import type { ThinkingStep } from '../../services/chat/view.js'
import { Markdown } from '../markdown/Markdown.js'
import styles from './ReplyArea.module.css'

const MONOLOGUE_KEYS = ['thinkMono1', 'thinkMono2', 'thinkMono3', 'thinkMono4', 'thinkMono5', 'thinkMono6'] as const

/** 流式思考时轮播"内心戏"短语 */
const useMonologue = (active: boolean) => {
  const t = useTranslate()
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setIndex((value) => (value + 1) % MONOLOGUE_KEYS.length), 2600)
    return () => clearInterval(timer)
  }, [active])
  return t(MONOLOGUE_KEYS[index])
}

/** 可折叠思考卡片：图标 + 内心戏/用时 + 展开查看完整思考 */
export const ThinkingCard = ({
  step,
  cacheKey,
  streaming,
}: {
  step: ThinkingStep
  cacheKey: string
  streaming: boolean
}) => {
  const t = useTranslate()
  const showThinking = useSettings((state) => state.showThinking)
  const lastBlock = step.blocks.at(-1)
  const active = streaming && lastBlock?.startedAt !== undefined && lastBlock.endedAt === undefined
  // 默认折叠：流式时只渲染轻量标题（内心戏），不实时重解析整段思考 Markdown，避免长思考拖慢界面；
  // 用户点击展开或思考结束后才渲染全文。
  const [open, setOpen] = useState(false)
  const monologue = useMonologue(active)

  if (!showThinking) return null

  const text = step.blocks.map((block) => block.thinking).join('')
  const first = step.blocks[0]
  const seconds =
    first?.startedAt !== undefined && lastBlock?.endedAt !== undefined
      ? getThinkingSeconds(first.startedAt, lastBlock.endedAt)
      : null

  return (
    <div className={styles.thinkCard} data-active={active}>
      <button
        type="button"
        className={styles.thinkHead}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={clsx(styles.thinkIcon, active && styles.thinkIconActive)}>
          <IconThinkOutline16 />
        </span>
        <span className={styles.thinkTitle}>{active ? monologue : t('thinkingDone')}</span>
        {seconds !== null && !active ? <span className={styles.thinkTime}>{t('thinkingSeconds', { seconds })}</span> : null}
        <span className={clsx(styles.thinkChevron, open && styles.thinkChevronOpen)}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open ? (
        <div className={styles.thinkBody}>
          <Markdown content={text} loading={active} cacheKey={cacheKey} disableLink />
        </div>
      ) : null}
    </div>
  )
}