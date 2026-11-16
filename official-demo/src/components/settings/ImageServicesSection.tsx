import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { setImageModelPref, useSettings } from '../../services/settings.js'
import {
  imageModels,
  imageOptions,
  listImageServices,
  saveImageService,
  deleteImageService,
  testImageService,
  saveServiceKey,
  type ImageModelEntry,
  type ImageOption,
  type ImageService,
  type ImageTestResult,
} from '../../services/panel.js'
import styles from './Settings.module.css'

/** 预设图像服务的动态模型下拉：实时拉取最新模型，所选模型用于聊天生图 */
const PresetModelSelect = ({ provider, defaultModel }: { provider: string; defaultModel: string }) => {
  const t = useTranslate()
  const preferred = useSettings((state) => state.imageModelPrefs[provider])
  const [models, setModels] = useState<ImageModelEntry[]>([{ id: defaultModel, name: defaultModel }])
  const [source, setSource] = useState<'live' | 'fallback'>('fallback')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void imageModels(provider)
      .then((result) => {
        if (!alive) return
        setModels(result.models.length ? result.models : [{ id: defaultModel, name: defaultModel }])
        setSource(result.source)
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [provider, defaultModel])

  return (
    <div className={styles.presetModelRow}>
      <span className={styles.fieldLabel}>
        {t('imgGenModel')}
        {source === 'live' ? <span className={styles.liveTag}>{t('imageModelLive')}</span> : null}
      </span>
      <Select
        ariaLabel={t('imgGenModel')}
        value={preferred || defaultModel}
        disabled={loading}
        options={models.map((entry) => ({ value: entry.id, label: entry.name }))}
        onChange={(value) => setImageModelPref(provider, value)}
      />
    </div>
  )
}

type FormState = {
  id?: string
  name: string
  endpoint: string
  generationModel: string
  editModel: string
  domains: string
  key: string
}

const emptyForm = (): FormState => ({
  name: '',
  endpoint: '',
  generationModel: '',
  editModel: '',
  domains: '',
  key: '',
})

const toForm = (service: ImageService): FormState => ({
  id: service.id,
  name: service.name,
  endpoint: service.endpoint,
  generationModel: service.generationModel,
  editModel: service.editModel,
  domains: service.domains.join(', '),
  key: '',
})

/** 图像服务：预设 4 家（独立 Key）+ 自定义 OpenAI 兼容端点，与对话服务商凭据隔离。 */
export const ImageServicesSection = () => {
  const t = useTranslate()
  const [options, setOptions] = useState<ImageOption[]>([])
  const [services, setServices] = useState<ImageService[]>([])
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ImageTestResult>>({})
  const [presetKeys, setPresetKeys] = useState<Record<string, string>>({})
  const [presetSaving, setPresetSaving] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [optionList, state] = await Promise.all([imageOptions(), listImageServices()])
      setOptions(optionList)
      setServices(state.services)
      setKeys(state.keys)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submit = async () => {
    if (!form || saving) return
    setSaving(true)
    setFormError('')
    try {
      await saveImageService(
        {
          ...(form.id ? { id: form.id } : {}),
          name: form.name,
          endpoint: form.endpoint,
          generationModel: form.generationModel,
          editModel: form.editModel.trim() || form.generationModel,
          domains: form.domains.split(/[,，\s]+/).map((domain) => domain.trim()).filter(Boolean),
        },
        form.key.trim() || undefined
      )
      setForm(null)
      showToast({ key: 'imgSaved' })
      await refresh()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await deleteImageService(id)
      setConfirmDelete(null)
      showToast({ key: 'imgDeleted' })
      await refresh()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  const runTest = async (id: string) => {
    setTesting(id)
    try {
      const result = await testImageService(id)
      setResults((current) => ({ ...current, [id]: result }))
    } catch (error) {
      setResults((current) => ({
        ...current,
        [id]: { ok: false, latencyMs: 0, error: error instanceof Error ? error.message : String(error) },
      }))
    } finally {
      setTesting(null)
    }
  }

  const savePresetKey = async (id: string) => {
    const key = (presetKeys[id] ?? '').trim()
    if (!key) return
    setPresetSaving(id)
    try {
      await saveServiceKey(id, key)
      setPresetKeys((current) => ({ ...current, [id]: '' }))
      showToast({ key: 'imgSaved' })
      await refresh()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setPresetSaving(null)
    }
  }

  if (form) {
    return (
      <div className={styles.provForm}>
        <div className={styles.formTitle}>{form.id ? t('imgEditTitle') : t('imgAddTitle')}</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('imgName')}</span>
          <input
            className={styles.input}
            value={form.name}
            maxLength={60}
            autoFocus
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('imgEndpoint')}</span>
          <input
            className={styles.input}
            value={form.endpoint}
            placeholder="https://api.example.com/v1/images/generations"
            spellCheck={false}
            onChange={(event) => setForm({ ...form, endpoint: event.target.value })}
          />
        </label>
        <div className={styles.fieldPair}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('imgGenModel')}</span>
            <input
              className={styles.input}
              value={form.generationModel}
              spellCheck={false}
              onChange={(event) => setForm({ ...form, generationModel: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('imgEditModel')}</span>
            <input
              className={styles.input}
              value={form.editModel}
              placeholder={t('imgEditModelHint')}
              spellCheck={false}
              onChange={(event) => setForm({ ...form, editModel: event.target.value })}
            />
          </label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('imgDomains')}</span>
          <input
            className={styles.input}
            value={form.domains}
            placeholder="cdn.example.com, images.example.com"
            spellCheck={false}
            onChange={(event) => setForm({ ...form, domains: event.target.value })}
          />
          <span className={styles.fieldHint}>{t('imgDomainsHint')}</span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('imgKey')}</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="off"
            value={form.key}
            placeholder={form.id ? t('provKeyKeep') : t('provKeyPlaceholder')}
            onChange={(event) => setForm({ ...form, key: event.target.value })}
          />
        </label>
        {formError ? <div className={styles.error}>{formError}</div> : null}
        <div className={styles.formActions}>
          <Button variant="outlined" size="m" disabled={saving} onClick={() => setForm(null)}>
            {t('provCancel')}
          </Button>
          <Button variant="primary" size="m" disabled={saving} onClick={() => void submit()}>
            {saving ? t('provSaving') : t('provSave')}
          </Button>
        </div>
      </div>
    )
  }

  const presets = options.filter((option) => !option.custom)
  return (
    <div className={styles.provSection}>
      <div className={styles.sectionHead}>
        <div>
          <div className={styles.label}>{t('settingsImages')}</div>
          <div className={styles.description}>{t('imgDescription')}</div>
        </div>
        <Button variant="primary" size="m" onClick={() => setForm(emptyForm())}>
          {t('imgAdd')}
        </Button>
      </div>
      {loading ? <div className={styles.description}>{t('provLoading')}</div> : null}
      {loadError ? <div className={styles.error}>{loadError}</div> : null}

      <div className={styles.subTitle}>{t('imgPresets')}</div>
      {presets.map((preset) => (
        <div key={preset.id} className={styles.provCard}>
          <div className={styles.provHead}>
            <span className={styles.provName}>{preset.name}</span>
            <span className={clsx(styles.tag, preset.ready ? styles.tagOk : styles.tagWarn)}>
              {preset.ready ? t('provKeyReady') : t('provKeyMissing')}
            </span>
          </div>
          <PresetModelSelect provider={preset.id} defaultModel={preset.generationModel} />
          <div className={styles.provMeta}>
            <span>
              {t('imgEditModel')}: {preset.editModel}
            </span>
          </div>
          <div className={styles.presetKeyRow}>
            <input
              className={styles.input}
              type="password"
              autoComplete="off"
              value={presetKeys[preset.id] ?? ''}
              placeholder={preset.ready ? t('imgKeyReplace') : t('provKeyPlaceholder')}
              onChange={(event) => setPresetKeys((current) => ({ ...current, [preset.id]: event.target.value }))}
            />
            <Button
              variant="outlined"
              size="s"
              disabled={presetSaving !== null || !(presetKeys[preset.id] ?? '').trim()}
              onClick={() => void savePresetKey(preset.id)}
            >
              {presetSaving === preset.id ? t('provSaving') : t('imgKeySave')}
            </Button>
          </div>
        </div>
      ))}

      <div className={styles.subTitle}>{t('imgCustom')}</div>
      {services.length === 0 && !loading ? <div className={styles.description}>{t('imgEmpty')}</div> : null}
      {services.map((service) => {
        const result = results[service.id]
        return (
          <div key={service.id} className={styles.provCard}>
            <div className={styles.provHead}>
              <span className={styles.provName}>{service.name}</span>
              <span className={clsx(styles.tag, keys[service.id] ? styles.tagOk : styles.tagWarn)}>
                {keys[service.id] ? t('provKeyReady') : t('provKeyMissing')}
              </span>
            </div>
            <div className={styles.provMeta}>
              <span className={styles.provUrl}>{service.endpoint}</span>
              <span>
                {service.generationModel}
                {service.editModel !== service.generationModel ? ` / ${service.editModel}` : ''}
              </span>
            </div>
            <div className={styles.provActions}>
              <Button
                variant="outlined"
                size="s"
                disabled={testing !== null || !keys[service.id]}
                onClick={() => void runTest(service.id)}
              >
                {testing === service.id ? t('provTesting') : t('imgTest')}
              </Button>
              <Button variant="outlined" size="s" onClick={() => setForm(toForm(service))}>
                {t('provEdit')}
              </Button>
              {confirmDelete === service.id ? (
                <>
                  <Button variant="danger" size="s" onClick={() => void remove(service.id)}>
                    {t('provDeleteConfirm')}
                  </Button>
                  <Button variant="outlined" size="s" onClick={() => setConfirmDelete(null)}>
                    {t('provCancel')}
                  </Button>
                </>
              ) : (
                <Button variant="dangerOutlined" size="s" onClick={() => setConfirmDelete(service.id)}>
                  {t('provDelete')}
                </Button>
              )}
            </div>
            {result ? (
              <div className={clsx(styles.testResult, result.ok ? styles.testOk : styles.testFail)}>
                {result.ok
                  ? t('imgTestOk', { ms: result.latencyMs, bytes: Math.round((result.bytes ?? 0) / 1024) })
                  : `${t('provTestFail')}${result.error ? `：${result.error}` : ''}`}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}