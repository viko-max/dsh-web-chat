import { useEffect, useRef, useState } from 'react'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { appendImageMessage } from '../../services/chat/store.js'
import { generateImage, refreshImageOptions, useImages } from '../../services/images.js'
import {
  imageModels,
  imageOptions,
  type ImageModelEntry,
  type ImageOption,
} from '../../services/panel.js'
import { closeImageStudio, useImageStudio } from './imageStudioState.js'
import { useObjectUrl } from './ImageMedia.js'
import styles from './ImageStudio.module.css'

/**
 * 生图对话框（ChatGPT 式）：选服务商 + 模型下拉（动态拉取最新）+ 描述 + 参考图。
 * 生成成功后作为图像卡片插入当前对话，并存入「我的图库」。
 */
export const ImageStudio = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const open = useImageStudio((state) => state.open)
  const editSource = useImageStudio((state) => state.editSource)
  const generating = useImages((state) => state.generating)
  const error = useImages((state) => state.error)

  const [options, setOptions] = useState<ImageOption[]>([])
  const [provider, setProvider] = useState('')
  const [models, setModels] = useState<ImageModelEntry[]>([])
  const [model, setModel] = useState('')
  const [modelSource, setModelSource] = useState<'live' | 'fallback'>('fallback')
  const [prompt, setPrompt] = useState('')
  const [reference, setReference] = useState<File | Blob | null>(null)
  const [parentId, setParentId] = useState<string | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)
  const referenceUrl = useObjectUrl(reference)

  useEffect(() => {
    if (!open) return
    void refreshImageOptions()
    void imageOptions().then((opts) => {
      setOptions(opts)
      const initial = editSource?.provider ?? opts.find((o) => o.ready)?.id ?? opts[0]?.id ?? ''
      setProvider(initial)
      setPrompt(editSource?.prompt ?? '')
      setReference(editSource?.blob ?? null)
      setParentId(editSource?.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editSource])

  // 切换服务商时拉取模型列表（预设与自定义服务均由 Host 动态拉取，失败回退默认）
  useEffect(() => {
    if (!open || !provider) return
    let alive = true
    void imageModels(provider).then((result) => {
      if (!alive) return
      setModels(result.models)
      setModelSource(result.source)
      setModel((current) => (result.models.some((m) => m.id === current) ? current : editSource?.model ?? result.models[0]?.id ?? ''))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider])

  if (!open) return null

  const submit = async () => {
    if (!provider || !prompt.trim() || generating) return
    try {
      const image = await generateImage({
        provider,
        prompt: prompt.trim(),
        model: model || undefined,
        reference: reference ?? undefined,
        sessionId,
        parentId,
      })
      if (sessionId) {
        appendImageMessage(sessionId, {
          type: 'generated_image',
          imageId: image.id,
          prompt: image.prompt,
          provider: image.provider,
          providerName: image.providerName,
          model: image.model,
          createdAt: image.createdAt,
        })
      }
      showToast({ key: 'imageGenerated' })
      closeImageStudio()
    } catch {
      // 错误已写入 store
    }
  }

  return (
    <Modal title={t('imageStudioTitle')} closable className={styles.studio} onClose={closeImageStudio}>
      <div className={styles.form}>
        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('imageService')}</span>
            <Select
              ariaLabel={t('imageService')}
              value={provider}
              placeholder={t('imageServicePlaceholder')}
              options={options.map((option) => ({
                value: option.id,
                label: option.ready ? option.name : `${option.name}（${t('provKeyMissing')}）`,
              }))}
              onChange={setProvider}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>
              {t('imageModel')}
              {modelSource === 'live' ? <span className={styles.liveTag}>{t('imageModelLive')}</span> : null}
            </span>
            <Select
              ariaLabel={t('imageModel')}
              value={model}
              placeholder={t('imageModel')}
              options={models.map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={setModel}
            />
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('imagePrompt')}</span>
          <textarea
            className={styles.prompt}
            value={prompt}
            rows={4}
            maxLength={2000}
            autoFocus
            placeholder={t('imagePromptPlaceholder')}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('imageReference')}</span>
          <div className={styles.referenceRow}>
            {referenceUrl ? <img className={styles.referenceThumb} src={referenceUrl} alt="" /> : null}
            <Button variant="outlined" size="s" onClick={() => fileRef.current?.click()}>
              {reference ? t('imageReferenceReplace') : t('imageReferencePick')}
            </Button>
            {reference ? (
              <Button
                variant="dangerOutlined"
                size="s"
                onClick={() => {
                  setReference(null)
                  setParentId(undefined)
                }}
              >
                {t('imageReferenceClear')}
              </Button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) {
                  setReference(file)
                  setParentId(undefined)
                }
              }}
            />
          </div>
          {parentId ? <span className={styles.hint}>{t('imageEditingHint')}</span> : null}
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
        <Button variant="primary" size="m" block disabled={generating || !provider || !prompt.trim()} onClick={() => void submit()}>
          {generating ? t('imageGenerating') : t('imageGenerate')}
        </Button>
      </div>
    </Modal>
  )
}