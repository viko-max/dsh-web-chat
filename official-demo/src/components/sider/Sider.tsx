import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconBrowseOutline16, IconPanelLeftOutline16, IconSearchOutline16, IconSettingsOutline16, NewChatIcon } from '../base/icons.js'
import { setSiderCollapsed, useSettings } from '../../services/settings.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import { PANEL_MODE } from '../../services/api/client.js'
import { openGallery } from '../images/imageViewerState.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { SiderMenu } from './SiderMenu.js'
import styles from './Sider.module.css'

/** 展开的侧边栏（ChatGPT 式）：品牌 + 收起、新对话、搜索、「最近」排序/显示菜单 + 扁平会话列表、底部设置 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const sort = useSettings((state) => state.siderSort)
  const compact = useSettings((state) => state.siderCompact)
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? sessions.filter((session) => (session.title || '').toLowerCase().includes(q)) : sessions
    return [...filtered].sort((a, b) => (sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt))
  }, [sessions, query, sort])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      {PANEL_MODE ? (
        <button
          type="button"
          className={styles.galleryNav}
          onClick={() => {
            openGallery()
            closeMobileSider()
          }}
        >
          <span className={styles.galleryNavIcon}>
            <IconBrowseOutline16 />
          </span>
          {t('imageGallery')}
        </button>
      ) : null}
      <div className={styles.search}>
        <IconSearchOutline16 />
        <input
          value={query}
          placeholder={t('siderSearch')}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('siderSearch')}
        />
      </div>
      <div className={styles.listWrap}>
        <div className={styles.listHead}>
          <SiderMenu />
          <IconButton
            size="xs"
            icon={<NewChatIcon />}
            tooltip={t('newChat')}
            tooltipPlacement="bottom"
            onClick={() => {
              newChat()
              closeMobileSider()
            }}
          />
        </div>
        <div className={clsx(styles.list, compact && styles.listCompact)}>
          {visible.length === 0 ? (
            <div className={styles.empty}>{t('siderEmpty')}</div>
          ) : (
            visible.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeId}
                onDelete={() => setDeleting(session)}
              />
            ))
          )}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}>
            <IconSettingsOutline16 />
          </span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}