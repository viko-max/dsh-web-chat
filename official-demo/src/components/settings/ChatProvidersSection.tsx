import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import {
  listChatProviders,
  saveChatProvider,
  deleteChatProvider,
  testChatProvider,
  serviceKeyStatus,
  saveServiceKey,
  type ChatProvider,
  type ChatProviderModel,
  type ChatTestResult,
} from '../../services/panel.js'
import styles from './Settings.module.css'

type FormState = {
  id?: string
  name: string
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  key: string
  models: ChatProviderModel[]
}

const emptyModel = (): ChatProviderModel => ({ id: '', name: '', tools: true, vision: false, thinking: false })

const emptyForm = (): FormState => ({
  name: '',
  protocol: 'openai',
  baseUrl: '',
  key: '',
  models: [emptyModel()],
})

const toForm = (provider: ChatProvider): FormState => ({
  id: provider.id,
  name: provider.name,
  protocol: provider.protocol,
  baseUrl: provider.baseUrl,
  key: '',
  models: provider.models.map((model) => ({ ...model })),
})

/** 对话服务商：自定义 OpenAI / Anthropic 兼容端点，凭据独立于图像服务。 */
export const ChatProvidersSection = () => {
  const t = useTranslate()
  const [providers, setProviders] = useState<ChatProvider[]>([])
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ChatTestResult>>({})
  const [sparkReady, setSparkReady] = useState(false)
  const [sparkKey, setSparkKey] = useState('')
  const [sparkSaving, setSparkSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const state = await listChatProviders()
      setProviders(state.providers)
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
    void serviceKeyStatus()
      .then((status) => setSparkReady(Boolean(status.spark)))
      .catch(() => {})
  }, [refresh])

  const saveSparkKey = async () => {
    const key = sparkKey.trim()
    if (!key || sparkSaving) return
    setSparkSaving(true)
    try {
      await saveServiceKey('spark', key)
      setSparkKey('')
      setSparkReady(true)
      showToast({ key: 'provSaved' })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSparkSaving(false)
    }
  }

  const submit = async () => {
    if (!form || saving) return
    setSaving(true)
    setFormError('')
    try {
      await saveChatProvider(
        {
          ...(form.id ? { id: form.id } : {}),
          name: form.name,
          protocol: form.protocol,
          baseUrl: form.baseUrl,
          models: form.models.map((model) => ({ ...model, name: model.name.trim() || model.id.trim() })),
        },
        form.key.trim() || undefined
      )
      setForm(null)
      showToast({ key: 'provSaved' })
      await refresh()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await deleteChatProvider(id)
      setConfirmDelete(null)
      showToast({ key: 'provDeleted' })
      await refresh()
    } catch (error) {
      showToast({ key: 'provDeleteFailed', type: 'error' })
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  const runTest = async (provider: ChatProvider, kind: 'connect' | 'tools') => {
    const testKey = `${provider.id}:${kind}`
    setTesting(testKey)
    try {
      const result = await testChatProvider(provider.id, provider.models[0]?.id ?? '', kind)
      setResults((current) => ({ ...current, [testKey]: result }))
    } catch (error) {
      setResults((current) => ({
        ...current,
        [testKey]: { ok: false, kind, latencyMs: 0, error: error instanceof Error ? error.message : String(error) },
      }))
    } finally {
      setTesting(null)
    }
  }

  const setModel = (index: number, patch: Partial<ChatProviderModel>) => {
    if (!form) return
    setForm({ ...form, models: form.models.map((model, i) => (i === index ? { ...model, ...patch } : model)) })
  }

  if (form) {
    return (
      <div className={styles.provForm}>
        <div className={styles.formTitle}>{form.id ? t('provEditTitle') : t('provAddTitle')}</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('provName')}</span>
          <input
            className={styles.input}
            value={form.name}
            maxLength={60}
            autoFocus
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('provProtocol')}</span>
          <Select
            ariaLabel={t('provProtocol')}
            value={form.protocol}
            options={[
              { value: 'openai', label: t('provProtocolOpenai') },
              { value: 'anthropic', label: t('provProtocolAnthropic') },
            ]}
            onChange={(value) => setForm({ ...form, protocol: value })}
          />
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('provBaseUrl')}</span>
          <input
            className={styles.input}
            value={form.baseUrl}
            placeholder={form.protocol === 'openai' ? 'https://api.example.com/v1' : 'https://api.example.com'}
            spellCheck={false}
            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
          />
          <span className={styles.fieldHint}>{t('provBaseUrlHint')}</span>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('provKey')}</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="off"
            value={form.key}
            placeholder={form.id ? t('provKeyKeep') : t('provKeyPlaceholder')}
            onChange={(event) => setForm({ ...form, key: event.target.value })}
          />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('provModels')}</span>
          <div className={styles.modelList}>
            {form.models.map((model, index) => (
              <div key={index} className={styles.modelRow}>
                <input
                  className={clsx(styles.input, styles.modelId)}
                  value={model.id}
                  placeholder={t('provModelId')}
                  spellCheck={false}
                  onChange={(event) => setModel(index, { id: event.target.value })}
                />
                <input
                  className={clsx(styles.input, styles.modelName)}
                  value={model.name}
                  placeholder={t('provModelName')}
                  onChange={(event) => setModel(index, { name: event.target.value })}
                />
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={model.tools}
                    onChange={(event) => setModel(index, { tools: event.target.checked })}
                  />
                  {t('provModelTools')}
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={model.vision}
                    onChange={(event) => setModel(index, { vision: event.target.checked })}
                  />
                  {t('provModelVision')}
                </label>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={model.thinking}
                    onChange={(event) => setModel(index, { thinking: event.target.checked })}
                  />
                  {t('provModelThinking')}
                </label>
                <Button
                  variant="dangerOutlined"
                  size="s"
                  disabled={form.models.length <= 1}
                  onClick={() => setForm({ ...form, models: form.models.filter((_, i) => i !== index) })}
                >
                  {t('provRemoveModel')}
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outlined"
            size="s"
            disabled={form.models.length >= 50}
            onClick={() => setForm({ ...form, models: [...form.models, emptyModel()] })}
          >
            {t('provAddModel')}
          </Button>
        </div>
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

  return (
    <div className={styles.provSection}>
      <div className={styles.sectionHead}>
        <div>
          <div className={styles.label}>{t('settingsProviders')}</div>
          <div className={styles.description}>{t('provDescription')}</div>
        </div>
        <Button variant="primary" size="m" onClick={() => setForm(emptyForm())}>
          {t('provAdd')}
        </Button>
      </div>
      {loading ? <div className={styles.description}>{t('provLoading')}</div> : null}
      {loadError ? <div className={styles.error}>{loadError}</div> : null}
      <div className={styles.provCard}>
        <div className={styles.provHead}>
          <span className={styles.provName}>Spark X2.6 · 讯飞星辰 MaaS</span>
          <span className={clsx(styles.tag, sparkReady ? styles.tagOk : styles.tagWarn)}>
            {sparkReady ? t('provKeyReady') : t('provKeyMissing')}
          </span>
        </div>
        <div className={styles.description}>{t('sparkKeyHint')}</div>
        <div className={styles.presetKeyRow}>
          <input
            className={styles.input}
            type="password"
            autoComplete="off"
            value={sparkKey}
            placeholder={sparkReady ? t('imgKeyReplace') : t('provKeyPlaceholder')}
            onChange={(event) => setSparkKey(event.target.value)}
          />
          <Button
            variant="outlined"
            size="s"
            disabled={sparkSaving || !sparkKey.trim()}
            onClick={() => void saveSparkKey()}
          >
            {sparkSaving ? t('provSaving') : t('imgKeySave')}
          </Button>
        </div>
      </div>
      {!loading && providers.length === 0 ? <div className={styles.description}>{t('provEmpty')}</div> : null}
      {providers.map((provider) => {
        const connectResult = results[`${provider.id}:connect`]
        const toolsResult = results[`${provider.id}:tools`]
        return (
          <div key={provider.id} className={styles.provCard}>
            <div className={styles.provHead}>
              <span className={styles.provName}>{provider.name}</span>
              <span className={styles.tag}>
                {provider.protocol === 'openai' ? t('provProtocolOpenai') : t('provProtocolAnthropic')}
              </span>
              <span className={clsx(styles.tag, keys[provider.id] ? styles.tagOk : styles.tagWarn)}>
                {keys[provider.id] ? t('provKeyReady') : t('provKeyMissing')}
              </span>
            </div>
            <div className={styles.provMeta}>
              <span className={styles.provUrl}>{provider.baseUrl}</span>
              <span>
                {provider.models.map((model) => model.id).join(' · ')}
              </span>
            </div>
            <div className={styles.provActions}>
              <Button
                variant="outlined"
                size="s"
                disabled={testing !== null || !keys[provider.id]}
                onClick={() => void runTest(provider, 'connect')}
              >
                {testing === `${provider.id}:connect` ? t('provTesting') : t('provTestConnect')}
              </Button>
              <Button
                variant="outlined"
                size="s"
                disabled={testing !== null || !keys[provider.id] || !provider.models.some((model) => model.tools)}
                onClick={() => void runTest(provider, 'tools')}
              >
                {testing === `${provider.id}:tools` ? t('provTesting') : t('provTestTools')}
              </Button>
              <Button variant="outlined" size="s" onClick={() => setForm(toForm(provider))}>
                {t('provEdit')}
              </Button>
              {confirmDelete === provider.id ? (
                <>
                  <Button variant="danger" size="s" onClick={() => void remove(provider.id)}>
                    {t('provDeleteConfirm')}
                  </Button>
                  <Button variant="outlined" size="s" onClick={() => setConfirmDelete(null)}>
                    {t('provCancel')}
                  </Button>
                </>
              ) : (
                <Button variant="dangerOutlined" size="s" onClick={() => setConfirmDelete(provider.id)}>
                  {t('provDelete')}
                </Button>
              )}
            </div>
            {connectResult ? <TestResult result={connectResult} /> : null}
            {toolsResult ? <TestResult result={toolsResult} /> : null}
          </div>
        )
      })}
    </div>
  )
}

const TestResult = ({ result }: { result: ChatTestResult }) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.testResult, result.ok ? styles.testOk : styles.testFail)}>
      <span>
        {result.ok
          ? t('provTestOk', { ms: result.latencyMs })
          : `${t('provTestFail')}${result.error ? `：${result.error}` : ''}`}
      </span>
      {result.ok && result.kind === 'connect' && result.sample ? (
        <span className={styles.testSample}>{result.sample}</span>
      ) : null}
      {result.ok && result.kind === 'tools' && result.trace?.finalText ? (
        <span className={styles.testSample}>
          {t('provToolsTrace', {
            tool: result.trace.toolCall?.name ?? 'dswc_echo',
            text: result.trace.finalText,
          })}
        </span>
      ) : null}
    </div>
  )
}