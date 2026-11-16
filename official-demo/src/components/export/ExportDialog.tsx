import { useState } from 'react'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { exportMarkdown, exportPng, exportText } from '../../services/export.js'
import { closeExportDialog, useExportDialog } from './exportState.js'
import styles from './ExportDialog.module.css'

type Format = 'markdown' | 'text' | 'png'

/** 对话导出分享：Markdown / 纯文本 / PNG 长图 */
export const ExportDialog = () => {
  const t = useTranslate()
  const open = useExportDialog((state) => state.open)
  const session = useChatStore((state) =>
    state.activeId ? state.sessionCache[state.activeId] : undefined
  )
  const [format, setFormat] = useState<Format>('png')
  const [includeThinking, setIncludeThinking] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!open || !session) return null

  const run = async () => {
    setBusy(true)
    try {
      if (format === 'markdown') {
        exportMarkdown(session, includeThinking)
      } else if (format === 'text') {
        exportText(session)
      } else {
        const node = document.querySelector<HTMLElement>('[data-export-root="true"]')
        if (!node) throw new Error('未找到对话内容')
        const bg = getComputedStyle(document.body).backgroundColor || '#ffffff'
        await exportPng(node, bg)
      }
      showToast({ key: 'exportDone' })
      closeExportDialog()
    } catch (error) {
      showToast({ key: 'exportFailed', type: 'error' })
      void error
    } finally {
      setBusy(false)
    }
  }

  const options: { value: Format; label: string; hint: string }[] = [
    { value: 'png', label: t('exportPng'), hint: t('exportPngHint') },
    { value: 'markdown', label: t('exportMarkdown'), hint: t('exportMarkdownHint') },
    { value: 'text', label: t('exportText'), hint: t('exportTextHint') },
  ]

  return (
    <Modal title={t('exportTitle')} closable onClose={closeExportDialog}>
      <div className={styles.options}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.option}
            data-active={format === option.value}
            onClick={() => setFormat(option.value)}
          >
            <span className={styles.optionLabel}>{option.label}</span>
            <span className={styles.optionHint}>{option.hint}</span>
          </button>
        ))}
      </div>
      {format === 'markdown' ? (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={includeThinking}
            onChange={(event) => setIncludeThinking(event.target.checked)}
          />
          {t('exportIncludeThinking')}
        </label>
      ) : null}
      <div className={styles.actions}>
        <Button variant="outlined" size="m" disabled={busy} onClick={closeExportDialog}>
          {t('cancel')}
        </Button>
        <Button variant="primary" size="m" disabled={busy} onClick={() => void run()}>
          {busy ? t('exporting') : t('exportDownload')}
        </Button>
      </div>
    </Modal>
  )
}