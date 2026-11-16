import { useEffect, useRef, useState } from 'react'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import {
  setBgBlur,
  setBgEffect,
  setBgImageId,
  setBgOpacity,
  useSettings,
} from '../../services/settings.js'
import { clearBackgroundImage, getBackgroundUrl, saveBackgroundImage } from '../../services/background.js'
import styles from './Settings.module.css'

const effectOptions = [
  { value: 'none', label: 'bgEffectNone' },
  { value: 'frosted', label: 'bgEffectFrosted' },
  { value: 'acrylic', label: 'bgEffectAcrylic' },
  { value: 'transparent', label: 'bgEffectTransparent' },
] as const

/** 外观：自定义背景图 + 毛玻璃/亚克力/透明效果 + 模糊/不透明度 */
export const BackgroundSetting = () => {
  const t = useTranslate()
  const effect = useSettings((state) => state.bgEffect)
  const blur = useSettings((state) => state.bgBlur)
  const opacity = useSettings((state) => state.bgOpacity)
  const imageId = useSettings((state) => state.bgImageId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    let objectUrl = ''
    if (imageId) {
      void getBackgroundUrl(imageId).then((url) => {
        if (alive && url) {
          objectUrl = url
          setPreview(url)
        }
      })
    } else {
      setPreview('')
    }
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageId])

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast({ key: 'bgInvalidType', type: 'error' })
      return
    }
    setBusy(true)
    try {
      if (imageId) await clearBackgroundImage(imageId)
      const id = await saveBackgroundImage(file)
      setBgImageId(id)
      if (effect === 'none') setBgEffect('frosted')
    } catch {
      showToast({ key: 'bgUploadFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (imageId) await clearBackgroundImage(imageId)
    setBgImageId(null)
    setBgEffect('none')
  }

  return (
    <div className={styles.bgSetting}>
      <div className={styles.label}>{t('settingsBackground')}</div>
      <div className={styles.description}>{t('bgHint')}</div>
      <div className={styles.bgRow}>
        {preview ? <img className={styles.bgPreview} src={preview} alt="" /> : null}
        <Button variant="outlined" size="s" disabled={busy} onClick={() => fileRef.current?.click()}>
          {imageId ? t('bgReplace') : t('bgUpload')}
        </Button>
        {imageId ? (
          <Button variant="dangerOutlined" size="s" disabled={busy} onClick={() => void clear()}>
            {t('bgClear')}
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
            if (file) void upload(file)
          }}
        />
      </div>
      {imageId ? (
        <>
          <div className={styles.bgRow}>
            <span className={styles.fieldLabel}>{t('bgEffect')}</span>
            <Select
              ariaLabel={t('bgEffect')}
              value={effect}
              options={effectOptions.map((option) => ({ value: option.value, label: t(option.label) }))}
              onChange={(value) => setBgEffect(value as typeof effect)}
            />
          </div>
          <div className={styles.bgSlider}>
            <span className={styles.fieldLabel}>{t('bgBlur')}</span>
            <input
              type="range"
              min={0}
              max={40}
              value={blur}
              aria-label={t('bgBlur')}
              onChange={(event) => setBgBlur(Number(event.target.value))}
            />
            <span className={styles.bgValue}>{blur}px</span>
          </div>
          <div className={styles.bgSlider}>
            <span className={styles.fieldLabel}>{t('bgOpacity')}</span>
            <input
              type="range"
              min={30}
              max={95}
              value={Math.round(opacity * 100)}
              aria-label={t('bgOpacity')}
              onChange={(event) => setBgOpacity(Number(event.target.value) / 100)}
            />
            <span className={styles.bgValue}>{Math.round(opacity * 100)}%</span>
          </div>
        </>
      ) : null}
    </div>
  )
}