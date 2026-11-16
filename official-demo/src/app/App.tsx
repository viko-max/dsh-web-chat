import { useEffect } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { ensureApiKey } from '../components/settings/settingsDialogState.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { Pet } from '../components/pet/Pet.js'
import { BackgroundLayer } from '../components/app/BackgroundLayer.js'
import { ImageStudio } from '../components/images/ImageStudio.js'
import { ImageViewer } from '../components/images/ImageViewer.js'
import { Gallery } from '../components/images/Gallery.js'
import { ExportDialog } from '../components/export/ExportDialog.js'
import { GmailPreview } from '../components/settings/GmailPreview.js'
import { AgentHandoff } from '../components/agent/AgentHandoff.js'
import { PANEL_MODE } from '../services/api/client.js'
import { loadImages, purgeSessionImages, refreshImageOptions } from '../services/images.js'
import { refreshApps } from '../services/apps.js'
import { startAutomationPolling, stopAutomationPolling } from '../services/automation.js'
import { setDraftText, getDraft } from '../services/chat/drafts.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  const bgActive = useSettings((state) => Boolean(state.bgImageId) && state.bgEffect !== 'none')
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    void initChat()
    // 首次打开先在设置里输入 API Key
    ensureApiKey()
  }, [])

  // 面板模式：加载本地图像库；会话删除时同步清理其图库条目
  useEffect(() => {
    if (!PANEL_MODE) return
    void loadImages()
    void refreshImageOptions()
    void refreshApps()
    startAutomationPolling()
    // QQ 机器人消息插入当前草稿
    const insert = (event: Event) => {
      const text = (event as CustomEvent<string>).detail
      if (typeof text !== 'string' || !text) return
      const sessionId = useChatStore.getState().activeId
      const current = getDraft(sessionId).text
      setDraftText(sessionId, current ? current + '\n' + text : text)
    }
    window.addEventListener('dswc-insert-draft', insert)
    let previous = new Set(useChatStore.getState().sessions.map((session) => session.id))
    const unsubscribe = useChatStore.subscribe((state) => {
      const current = new Set(state.sessions.map((session) => session.id))
      const removed = new Set([...previous].filter((id) => !current.has(id)))
      previous = current
      if (removed.size > 0) void purgeSessionImages(removed)
    })
    return () => {
      window.removeEventListener('dswc-insert-draft', insert)
      unsubscribe()
      stopAutomationPolling()
    }
  }, [])

  return (
    <>
      <div ref={frameRef} className={styles.frame} data-bg-active={bgActive ? 'true' : undefined}>
        <BackgroundLayer />
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
          <Pet />
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      {PANEL_MODE ? <ImageStudio sessionId={activeId} /> : null}
      {PANEL_MODE ? <ImageViewer /> : null}
      {PANEL_MODE ? <Gallery /> : null}
      <ExportDialog />
      {PANEL_MODE ? <GmailPreview /> : null}
      {PANEL_MODE ? <AgentHandoff /> : null}
      <Toast />
    </>
  )
}
