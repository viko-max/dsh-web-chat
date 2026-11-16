import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { useTranslate } from '../../i18n/index.js'
import { useChatStore } from '../../services/chat/store.js'
import { usePanelModels } from '../../services/panelModels.js'
import {
  deleteAutomationTask,
  deliverInbox,
  refreshAutomation,
  saveAutomationTask,
  toggleAutomationTask,
  useAutomation,
  type AutomationTask,
} from '../../services/automation.js'
import styles from './Settings.module.css'

type FormState = {
  id?: string
  title: string
  prompt: string
  instructions: string
  session: string
  next: string
  every: number
  modelValue: string
  mail: string
  query: string
  allowMail: boolean
}

const toLocalInput = (timestamp: number) => {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const emptyForm = (sessionId: string | null): FormState => ({
  title: '',
  prompt: '',
  instructions: '',
  session: sessionId ?? '',
  next: toLocalInput(Date.now() + 3600000),
  every: 0,
  modelValue: '',
  mail: '',
  query: '',
  allowMail: false,
})

/** 自动化：后台定时任务，结果写入目标网页对话。 */
export const AutomationSection = () => {
  const t = useTranslate()
  const tasks = useAutomation((state) => state.tasks)
  const inbox = useAutomation((state) => state.inbox)
  const error = useAutomation((state) => state.error)
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const catalog = usePanelModels((state) => state.catalog)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    void refreshAutomation()
  }, [])

  const submit = async () => {
    if (!form || saving) return
    setSaving(true)
    setFormError('')
    try {
      const next = new Date(form.next).getTime()
      if (!form.title.trim() || !form.prompt.trim() || !form.session || !Number.isFinite(next)) {
        throw new Error(t('autoFillRequired'))
      }
      const [provider, model] = form.modelValue ? form.modelValue.split('\u0000') : []
      await saveAutomationTask({
        ...(form.id ? { id: form.id } : {}),
        title: form.title.trim(),
        prompt: form.prompt.trim(),
        instructions: form.instructions.trim(),
        session: form.session,
        next,
        every: form.every,
        ...(provider && model ? { model: { provider, model } } : { model: null }),
        ...(form.mail ? { mail: form.mail, query: form.query.trim(), allowMail: form.allowMail } : {}),
      })
      setForm(null)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const edit = (task: AutomationTask) => {
    setForm({
      id: task.id,
      title: task.title,
      prompt: task.prompt,
      instructions: task.instructions,
      session: task.session,
      next: toLocalInput(task.next),
      every: task.every,
      modelValue: task.model ? `${task.model.provider}\u0000${task.model.model}` : '',
      mail: task.mail ?? '',
      query: task.query ?? '',
      allowMail: Boolean(task.mail),
    })
  }

  if (form) {
    return (
      <div className={styles.provForm}>
        <div className={styles.formTitle}>{form.id ? t('autoEditTitle') : t('autoAddTitle')}</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('autoTitle')}</span>
          <input
            className={styles.input}
            value={form.title}
            maxLength={80}
            autoFocus
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('autoPrompt')}</span>
          <textarea
            className={styles.autoTextarea}
            value={form.prompt}
            rows={3}
            maxLength={24000}
            onChange={(event) => setForm({ ...form, prompt: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('autoInstructions')}</span>
          <textarea
            className={styles.autoTextarea}
            value={form.instructions}
            rows={2}
            maxLength={24000}
            placeholder={t('autoInstructionsHint')}
            onChange={(event) => setForm({ ...form, instructions: event.target.value })}
          />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('autoTargetSession')}</span>
          <Select
            ariaLabel={t('autoTargetSession')}
            value={form.session}
            placeholder={t('autoTargetSession')}
            options={sessions.map((session) => ({
              value: session.id,
              label: session.title || t('untitledChat'),
            }))}
            onChange={(value) => setForm({ ...form, session: value })}
          />
        </div>
        <div className={styles.fieldPair}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('autoNextRun')}</span>
            <input
              className={styles.input}
              type="datetime-local"
              value={form.next}
              onChange={(event) => setForm({ ...form, next: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('autoEvery')}</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={525600}
              value={form.every}
              onChange={(event) => setForm({ ...form, every: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('autoModel')}</span>
          <Select
            ariaLabel={t('autoModel')}
            value={form.modelValue}
            placeholder={t('autoModelDefault')}
            options={[
              { value: '', label: t('autoModelDefault') },
              ...catalog.map((item) => ({
                value: `${item.provider}\u0000${item.model}`,
                label: item.name,
              })),
            ]}
            onChange={(value) => setForm({ ...form, modelValue: value })}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('autoMailSource')}</span>
          <Select
            ariaLabel={t('autoMailSource')}
            value={form.mail}
            options={[
              { value: '', label: t('autoMailNone') },
              { value: 'gmail', label: 'Gmail' },
              { value: 'outlook', label: 'Outlook' },
              { value: 'qqmail', label: t('appsQqmailAddress').replace('地址', '') },
            ]}
            onChange={(value) => setForm({ ...form, mail: value })}
          />
        </div>
        {form.mail ? (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('autoMailQuery')}</span>
              <input
                className={styles.input}
                value={form.query}
                maxLength={300}
                onChange={(event) => setForm({ ...form, query: event.target.value })}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.allowMail}
                onChange={(event) => setForm({ ...form, allowMail: event.target.checked })}
              />
              {t('autoAllowMail')}
            </label>
          </>
        ) : null}
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
          <div className={styles.label}>{t('settingsAutomation')}</div>
          <div className={styles.description}>{t('autoDescription')}</div>
        </div>
        <Button
          variant="primary"
          size="m"
          disabled={sessions.length === 0}
          onClick={() => setForm(emptyForm(activeId ?? sessions[0]?.id ?? null))}
        >
          {t('autoAdd')}
        </Button>
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}
      {tasks.length === 0 ? <div className={styles.description}>{t('autoEmpty')}</div> : null}
      {tasks.map((task) => (
        <div key={task.id} className={styles.provCard}>
          <div className={styles.provHead}>
            <span className={styles.provName}>{task.title}</span>
            <span className={clsx(styles.tag, task.enabled ? styles.tagOk : styles.tagWarn)}>
              {task.enabled ? t('autoEnabled') : t('autoDisabled')}
            </span>
            {task.last ? (
              <span className={styles.tag}>
                {task.last.status === 'running'
                  ? t('autoRunning')
                  : task.last.status === 'done'
                    ? t('autoLastDone')
                    : t('autoLastError')}
              </span>
            ) : null}
          </div>
          <div className={styles.provMeta}>
            <span>
              {t('autoNextRun')}: {new Date(task.next).toLocaleString()}
              {task.every > 0 ? ` · ${t('autoEvery')} ${task.every} min` : ''}
            </span>
            <span className={styles.provUrl}>{task.prompt.slice(0, 120)}</span>
          </div>
          <div className={styles.provActions}>
            <Button variant="outlined" size="s" onClick={() => void toggleAutomationTask(task.id)}>
              {task.enabled ? t('autoPause') : t('autoResume')}
            </Button>
            <Button variant="outlined" size="s" onClick={() => edit(task)}>
              {t('provEdit')}
            </Button>
            {confirmDelete === task.id ? (
              <>
                <Button variant="danger" size="s" onClick={() => void deleteAutomationTask(task.id)}>
                  {t('provDeleteConfirm')}
                </Button>
                <Button variant="outlined" size="s" onClick={() => setConfirmDelete(null)}>
                  {t('provCancel')}
                </Button>
              </>
            ) : (
              <Button variant="dangerOutlined" size="s" onClick={() => setConfirmDelete(task.id)}>
                {t('provDelete')}
              </Button>
            )}
          </div>
        </div>
      ))}
      {inbox.length > 0 ? (
        <>
          <div className={styles.subTitle}>{t('autoInbox')}</div>
          <Button variant="outlined" size="s" onClick={() => void deliverInbox()}>
            {t('autoDeliver')}
          </Button>
          {inbox.map((item) => (
            <div key={item.id} className={styles.provCard}>
              <div className={styles.provHead}>
                <span className={styles.provName}>{item.title}</span>
                <span className={clsx(styles.tag, item.status === 'done' ? styles.tagOk : styles.tagWarn)}>
                  {item.status === 'done' ? t('autoLastDone') : t('autoLastError')}
                </span>
              </div>
              <div className={styles.provMeta}>
                <span className={styles.provUrl}>{item.text.slice(0, 200)}</span>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}