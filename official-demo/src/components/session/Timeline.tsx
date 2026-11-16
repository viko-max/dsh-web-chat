import { useMemo } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { getVisibleMessages } from '../../services/chat/branches.js'
import type { Session } from '../../services/chat/types.js'
import { useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Timeline.module.css'

const formatTime = (timestamp: number, locale: string) =>
  new Date(timestamp).toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** 对话时间记录轴：每个提问一个刻度，悬停显示时间与摘要，点击跳转到对应消息 */
export const Timeline = ({ session }: { session: Session }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const points = useMemo(
    () =>
      getVisibleMessages(session)
        .filter((message) => message.role === 'user')
        .map((message) => ({
          id: message.id,
          at: message.createdAt,
          snippet: (message.role === 'user' ? message.content : '').replace(/\s+/g, ' ').slice(0, 40),
        })),
    [session]
  )
  if (isMobile || points.length < 2) return null

  const jump = (id: string) => {
    const target = document.querySelector(`[data-msg-id="${CSS.escape(id)}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav className={styles.rail} aria-label={t('timelineLabel')}>
      <div className={styles.line} aria-hidden="true" />
      {points.map((point) => (
        <button
          key={point.id}
          type="button"
          className={styles.tick}
          onClick={() => jump(point.id)}
          aria-label={`${formatTime(point.at, locale)} ${point.snippet}`}
        >
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.tip} role="tooltip">
            <span className={styles.tipTime}>{formatTime(point.at, locale)}</span>
            <span className={styles.tipText}>{point.snippet || t('timelineImageOnly')}</span>
          </span>
        </button>
      ))}
    </nav>
  )
}