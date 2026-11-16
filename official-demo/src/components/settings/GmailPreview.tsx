import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { useTranslate } from '../../i18n/index.js'
import { resolveGmailPreview, useGmailPreview } from '../../services/apps.js'
import styles from './Settings.module.css'

/** Gmail 数据预览：原始邮件数据只在用户确认后才随本轮请求交给模型。 */
export const GmailPreview = () => {
  const t = useTranslate()
  const pending = useGmailPreview((state) => state.pending)
  if (!pending) return null
  return (
    <Modal
      title={t('gmailPreviewTitle')}
      closable
      onClose={() => resolveGmailPreview(false)}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={() => resolveGmailPreview(false)}>
            {t('gmailPreviewReject')}
          </Button>
          <Button variant="primary" size="m" autoFocus onClick={() => resolveGmailPreview(true)}>
            {t('gmailPreviewConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.description}>{t('gmailPreviewDescription')}</div>
      <pre className={styles.gmailPreviewBody}>{pending.resultText}</pre>
    </Modal>
  )
}