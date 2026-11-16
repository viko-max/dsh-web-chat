import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconSettingsOutline16 } from '../base/icons.js'
import { setSessionPersonalization, useSettings } from '../../services/settings.js'
import { isDefaultPersonalization, mergePersonalization } from '../../services/personalization.js'
import { useTranslate } from '../../i18n/index.js'
import { PersonalizationFields } from './PersonalizationFields.js'
import styles from './Personalization.module.css'

/** 会话级个性化覆盖：弹出六个维度，可恢复全局默认 */
export const SessionPersonalization = ({ sessionId }: { sessionId: string }) => {
  const t = useTranslate()
  const global = useSettings((state) => state.personalization)
  const session = useSettings((state) => state.sessionPersonalization[sessionId])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const value = mergePersonalization(global, session)
  const active = Boolean(session) && !isDefaultPersonalization(session)

  return (
    <div className={styles.popWrap} ref={ref}>
      <button
        type="button"
        className={clsx(styles.popTrigger, active && styles.popTriggerActive)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('persSessionTitle')}
        onClick={() => setOpen((v) => !v)}
      >
        <IconSettingsOutline16 />
      </button>
      {open ? (
        <div className={styles.pop} role="dialog">
          <div className={styles.popHead}>
            <span className={styles.popTitle}>{t('persSessionTitle')}</span>
            {session ? (
              <button
                type="button"
                className={styles.popReset}
                onClick={() => setSessionPersonalization(sessionId, null)}
              >
                {t('persResetGlobal')}
              </button>
            ) : null}
          </div>
          <PersonalizationFields
            value={value}
            onChange={(next) => setSessionPersonalization(sessionId, next)}
          />
        </div>
      ) : null}
    </div>
  )
}