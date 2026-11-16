import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { PANEL_MODE } from '../../services/api/client.js'
import { openAgentHandoff } from '../../services/agent.js'
import { openExportDialog } from '../export/exportState.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconDownloadOutline16 } from '../base/icons.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import { ModelPicker } from './ModelPicker.js'
import { Timeline } from './Timeline.js'
import { PetToggle } from '../pet/PetToggle.js'
import { SessionPersonalization } from '../settings/SessionPersonalization.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          {PANEL_MODE ? (
            <div className={styles.headerActions}>
              <IconButton
                size="m"
                icon={<IconDownloadOutline16 />}
                tooltip={t('exportTitle')}
                tooltipPlacement="bottom"
                onClick={openExportDialog}
              />
              <SessionPersonalization sessionId={session.id} />
              <PetToggle />
              <Button variant="outlined" size="s" onClick={() => openAgentHandoff()}>
                {t('agentButton')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ModelPicker sessionId={session.id} />
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
      <Timeline session={session} />
    </div>
  )
}
