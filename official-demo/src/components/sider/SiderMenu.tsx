import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconChevronRightOutline14, IconCheckOutline16 } from '../base/icons.js'
import { setSiderCompact, setSiderSort, useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './SiderMenu.module.css'

type Section = 'sort' | 'display' | null

/** 侧边栏「最近」头部菜单：整理 / 排序方式 / 显示（参考 ChatGPT） */
export const SiderMenu = () => {
  const t = useTranslate()
  const sort = useSettings((state) => state.siderSort)
  const compact = useSettings((state) => state.siderCompact)
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<Section>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
        setSection(null)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setSection(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const row = (label: string, active: boolean, onClick: () => void) => (
    <button type="button" className={styles.option} onClick={onClick}>
      <span>{label}</span>
      {active ? <IconCheckOutline16 /> : null}
    </button>
  )

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
          setSection(null)
        }}
      >
        {t('siderRecent')}
        <span className={clsx(styles.chevron, open && styles.chevronOpen)}>
          <IconChevronRightOutline14 />
        </span>
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            className={styles.item}
            onClick={() => setSiderCompact(!compact)}
          >
            <span>{t('siderOrganize')}</span>
            <span className={styles.hint}>{compact ? t('siderCompactOn') : t('siderCompactOff')}</span>
          </button>
          <button
            type="button"
            className={clsx(styles.item, section === 'sort' && styles.itemActive)}
            onClick={() => setSection((value) => (value === 'sort' ? null : 'sort'))}
          >
            <span>{t('siderSortBy')}</span>
            <span className={clsx(styles.arrow, section === 'sort' && styles.arrowOpen)}>
              <IconChevronRightOutline14 />
            </span>
          </button>
          {section === 'sort' ? (
            <div className={styles.sub}>
              {row(t('siderSortUpdated'), sort === 'updated', () => setSiderSort('updated'))}
              {row(t('siderSortCreated'), sort === 'created', () => setSiderSort('created'))}
            </div>
          ) : null}
          <button
            type="button"
            className={clsx(styles.item, section === 'display' && styles.itemActive)}
            onClick={() => setSection((value) => (value === 'display' ? null : 'display'))}
          >
            <span>{t('siderDisplay')}</span>
            <span className={clsx(styles.arrow, section === 'display' && styles.arrowOpen)}>
              <IconChevronRightOutline14 />
            </span>
          </button>
          {section === 'display' ? (
            <div className={styles.sub}>
              {row(t('siderComfortable'), !compact, () => setSiderCompact(false))}
              {row(t('siderCompact'), compact, () => setSiderCompact(true))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}