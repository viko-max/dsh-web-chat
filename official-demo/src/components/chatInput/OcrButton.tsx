import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { extractText } from '../../services/panel.js'
import styles from './ChatInput.module.css'

/**
 * 提取文字（OCR）：选择图片/PDF → Host 识别 → 预览结果 → 确认后插入草稿。
 * 仅面板模式渲染。
 */
export const OcrButton = ({ onInsert, disabled }: { onInsert: (text: string) => void; disabled: boolean }) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const pick = async (file: File) => {
    setBusy(true)
    try {
      const text = await extractText(file)
      if (!text) {
        showToast({ key: 'ocrEmpty', type: 'error' })
        return
      }
      setResult(text)
    } catch (error) {
      showToast({ key: 'ocrFailed', type: 'error' })
      void error
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={clsx(styles.toggle, busy && styles.selected)}
        aria-label={t('ocrButton')}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        <span className={styles.toggleLabel}>{busy ? t('ocrBusy') : t('ocrButton')}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void pick(file)
        }}
      />
      {result !== null ? (
        <Modal
          title={t('ocrTitle')}
          closable
          onClose={() => setResult(null)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setResult(null)}>
                {t('provCancel')}
              </Button>
              <Button
                variant="primary"
                size="m"
                onClick={() => {
                  onInsert(result)
                  setResult(null)
                }}
              >
                {t('ocrInsert')}
              </Button>
            </>
          }
        >
          <textarea className={styles.ocrPreview} readOnly value={result} rows={12} />
        </Modal>
      ) : null}
    </>
  )
}