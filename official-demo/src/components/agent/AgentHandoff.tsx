import { useEffect, useRef, useState } from 'react'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { useTranslate } from '../../i18n/index.js'
import {
  agentCreate,
  agentOptions,
  agentSend,
  agentState,
  agentStop,
  closeAgentHandoff,
  openHarnessSession,
  useAgentHandoff,
  type AgentOptions,
} from '../../services/agent.js'
import styles from './AgentHandoff.module.css'

const turnLabels: Record<string, string> = {
  completed: '已完成',
  aborted: '已停止',
  error: '执行失败，详情见 Harness 会话',
  blocked: '任务受阻，详情见 Harness 会话',
  interrupted: '任务已中断',
  'max-tokens': '达到输出上限',
}

/** Agent 移交：选择工作区与模型，把任务交给 Harness 原生会话，轮询执行状态。 */
export const AgentHandoff = () => {
  const t = useTranslate()
  const open = useAgentHandoff((state) => state.open)
  const prefill = useAgentHandoff((state) => state.prefill)
  const [options, setOptions] = useState<AgentOptions | null>(null)
  const [workspaceId, setWorkspaceId] = useState('')
  const [modelValue, setModelValue] = useState('')
  const [text, setText] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [replies, setReplies] = useState<{ seq: number; text: string }[]>([])
  const [lastTurn, setLastTurn] = useState<string | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!open) return
    setText(prefill)
    setError('')
    setReplies([])
    setLastTurn(undefined)
    setSessionId('')
    setRunning(false)
    void agentOptions()
      .then((result) => {
        setOptions(result)
        setWorkspaceId(result.workspaces[0]?.id ?? '')
        setModelValue(
          result.models[0] ? `${result.models[0].provider}\u0000${result.models[0].model}` : ''
        )
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [open, prefill])

  // 移交后轮询原生会话状态
  useEffect(() => {
    if (!sessionId) return
    const controller = new AbortController()
    const poll = async () => {
      try {
        const result = await agentState(sessionId, controller.signal)
        setReplies(result.replies)
        setLastTurn(result.lastTurn)
        setRunning(!result.lastTurn)
      } catch {
        // 轮询失败静默重试
      }
    }
    void poll()
    pollRef.current = setInterval(() => void poll(), 3000)
    return () => {
      controller.abort()
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [sessionId])

  if (!open) return null

  const submit = async () => {
    const task = text.trim()
    if (!task || busy) return
    setBusy(true)
    setError('')
    try {
      let target = sessionId
      if (!target) {
        target = (await agentCreate(workspaceId || undefined)).sessionId
        setSessionId(target)
      }
      const selection = modelValue ? (modelValue.split('\u0000') as [string, string]) : undefined
      await agentSend(target, crypto.randomUUID(), task, selection)
      setRunning(true)
      setText('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('agentTitle')} closable className={styles.dialog} onClose={closeAgentHandoff}>
      <div className={styles.form}>
        <div className={styles.row}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('agentWorkspace')}</span>
            <Select
              ariaLabel={t('agentWorkspace')}
              value={workspaceId}
              placeholder={t('agentWorkspaceDefault')}
              options={[
                { value: '', label: t('agentWorkspaceDefault') },
                ...(options?.workspaces.map((item) => ({ value: item.id, label: item.name })) ?? []),
              ]}
              onChange={setWorkspaceId}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('agentModel')}</span>
            <Select
              ariaLabel={t('agentModel')}
              value={modelValue}
              placeholder={t('agentModelDefault')}
              options={[
                { value: '', label: t('agentModelDefault') },
                ...(options?.models.map((item) => ({
                  value: `${item.provider}\u0000${item.model}`,
                  label: item.name,
                })) ?? []),
              ]}
              onChange={setModelValue}
            />
          </div>
        </div>
        <textarea
          className={styles.task}
          value={text}
          rows={5}
          maxLength={32000}
          placeholder={t('agentTaskPlaceholder')}
          onChange={(event) => setText(event.target.value)}
        />
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.actions}>
          {sessionId ? (
            <>
              <Button
                variant="outlined"
                size="m"
                onClick={() => {
                  if (!openHarnessSession(sessionId)) setError(t('agentBridgeMissing'))
                }}
              >
                {t('agentOpenSession')}
              </Button>
              {running ? (
                <Button variant="dangerOutlined" size="m" onClick={() => void agentStop(sessionId)}>
                  {t('agentStop')}
                </Button>
              ) : null}
            </>
          ) : null}
          <Button variant="primary" size="m" disabled={busy || !text.trim()} onClick={() => void submit()}>
            {busy ? t('agentSending') : t('agentSend')}
          </Button>
        </div>
        {sessionId ? (
          <div className={styles.progress}>
            <div className={styles.progressStatus}>
              {running ? t('agentRunning') : turnLabels[lastTurn ?? ''] ?? t('agentIdle')}
            </div>
            {replies.slice(0, 3).map((reply) => (
              <pre key={reply.seq} className={styles.reply}>
                {reply.text.slice(0, 2000)}
              </pre>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}