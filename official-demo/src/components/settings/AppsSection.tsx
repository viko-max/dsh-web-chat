import { useEffect, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { GitHubIcon, GmailIcon, OutlookIcon, QQMailIcon, QQBotIcon } from './AppIcons.js'
import {
  connectApp,
  disconnectApp,
  configureApp,
  qqBotInbox,
  refreshApps,
  useApps,
  type AppProvider,
  type QQBotMessage,
} from '../../services/apps.js'
import styles from './Settings.module.css'

const appLabels: Record<AppProvider, string> = {
  github: 'GitHub',
  gmail: 'Gmail',
  outlook: 'Outlook',
  qqmail: 'QQ 邮箱',
  qqbot: 'QQ 机器人',
}

const appIcons: Record<AppProvider, ReactNode> = {
  github: <GitHubIcon />,
  gmail: <GmailIcon />,
  outlook: <OutlookIcon />,
  qqmail: <QQMailIcon />,
  qqbot: <QQBotIcon />,
}

/** 外部跳转链接 + 小字说明 */
const AppLink = ({ href, label, note }: { href: string; label: string; note: string }) => (
  <div className={styles.appLinkRow}>
    <a className={styles.appLink} href={href} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
    <span className={styles.appNote}>{note}</span>
  </div>
)

/** 连接应用：OAuth 授权（GitHub/Gmail/Outlook）与凭据直连（QQ 邮箱/QQ 机器人）。 */
export const AppsSection = () => {
  const t = useTranslate()
  const status = useApps((state) => state.status)
  const error = useApps((state) => state.error)
  const [busy, setBusy] = useState<string | null>(null)
  const [qqmail, setQqmail] = useState({ address: '', authorization: '' })
  const [qqbot, setQqbot] = useState({ appId: '', secret: '' })
  const [outlookClientId, setOutlookClientId] = useState('')
  const [inbox, setInbox] = useState<QQBotMessage[] | null>(null)

  useEffect(() => {
    void refreshApps()
  }, [])

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    try {
      await action()
    } catch {
      // 错误已写入 store
    } finally {
      setBusy(null)
    }
  }

  const connected = (provider: AppProvider) => {
    const item = status?.[provider]
    return item?.account != null || item?.phase === 'connected'
  }

  const oauthCard = (provider: 'github' | 'gmail' | 'outlook') => {
    const item = status?.[provider]
    const isConnected = connected(provider)
    return (
      <div key={provider} className={styles.provCard}>
        <div className={styles.provHead}>
          <span className={styles.appIcon}>{appIcons[provider]}</span>
          <span className={styles.provName}>{appLabels[provider]}</span>
          <span
            className={clsx(
              styles.tag,
              isConnected ? styles.tagOk : item?.pending ? styles.tag : styles.tagWarn
            )}
          >
            {isConnected
              ? (item?.account ?? t('appsConnected'))
              : item?.pending
                ? t('appsPending')
                : item?.phase === 'expired'
                  ? t('appsExpired')
                  : t('appsNotConnected')}
          </span>
        </div>
        {item?.userCode ? (
          <div className={styles.description}>
            {t('appsDeviceCode')}: <code>{item.userCode}</code>
          </div>
        ) : null}
        {item?.error ? <div className={styles.error}>{item.error}</div> : null}
        {provider === 'github' ? (
          <AppLink href="https://github.com/settings/developers" label={t('appsGithubLink')} note={t('appsGithubNote')} />
        ) : null}
        {provider === 'gmail' ? (
          <AppLink href="https://console.cloud.google.com/apis/credentials" label={t('appsGmailLink')} note={t('appsGmailNote')} />
        ) : null}
        {provider === 'outlook' && !isConnected ? (
          <div className={styles.presetKeyRow}>
            <input
              className={styles.input}
              value={outlookClientId}
              placeholder={t('appsOutlookClientId')}
              spellCheck={false}
              onChange={(event) => setOutlookClientId(event.target.value)}
            />
            <Button
              variant="outlined"
              size="s"
              disabled={busy !== null || !outlookClientId.trim()}
              onClick={() =>
                void run('outlook-config', () => configureApp('outlook', outlookClientId.trim()))
              }
            >
              {t('appsSaveConfig')}
            </Button>
          </div>
        ) : null}
        <div className={styles.provActions}>
          {isConnected ? (
            <Button
              variant="dangerOutlined"
              size="s"
              disabled={busy !== null}
              onClick={() => void run(provider, () => disconnectApp(provider))}
            >
              {t('appsDisconnect')}
            </Button>
          ) : (
            <Button
              variant="outlined"
              size="s"
              disabled={busy !== null || item?.pending || (provider === 'outlook' && !item?.configured)}
              onClick={() => void run(provider, () => connectApp(provider))}
            >
              {item?.pending ? t('appsPending') : t('appsConnect')}
            </Button>
          )}
          {item?.pending && item.authorizeUrl ? (
            <Button
              variant="outlined"
              size="s"
              onClick={() => window.open(item.authorizeUrl!, '_blank', 'noopener')}
            >
              {t('appsOpenAuth')}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.provSection}>
      <div className={styles.sectionHead}>
        <div>
          <div className={styles.label}>{t('settingsApps')}</div>
          <div className={styles.description}>{t('appsDescription')}</div>
        </div>
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}
      {oauthCard('github')}
      {oauthCard('gmail')}
      {oauthCard('outlook')}

      <div className={styles.provCard}>
        <div className={styles.provHead}>
          <span className={styles.appIcon}>{appIcons.qqmail}</span>
          <span className={styles.provName}>{appLabels.qqmail}</span>
          <span className={clsx(styles.tag, connected('qqmail') ? styles.tagOk : styles.tagWarn)}>
            {connected('qqmail') ? (status?.qqmail.account ?? t('appsConnected')) : t('appsNotConnected')}
          </span>
        </div>
        <div className={styles.description}>{t('appsQqmailHint')}</div>
        <AppLink href="https://wx.mail.qq.com/" label={t('appsQqmailLink')} note={t('appsQqmailNote')} />
        <AppLink href="https://service.mail.qq.com/detail/0/75" label={t('appsQqmailAuthLink')} note={t('appsQqmailAuthNote')} />
        {connected('qqmail') ? (
          <div className={styles.provActions}>
            <Button
              variant="dangerOutlined"
              size="s"
              disabled={busy !== null}
              onClick={() => void run('qqmail', () => disconnectApp('qqmail'))}
            >
              {t('appsDisconnect')}
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.presetKeyRow}>
              <input
                className={styles.input}
                value={qqmail.address}
                placeholder={t('appsQqmailAddress')}
                spellCheck={false}
                onChange={(event) => setQqmail({ ...qqmail, address: event.target.value })}
              />
            </div>
            <div className={styles.presetKeyRow}>
              <input
                className={styles.input}
                type="password"
                autoComplete="off"
                value={qqmail.authorization}
                placeholder={t('appsQqmailAuth')}
                onChange={(event) => setQqmail({ ...qqmail, authorization: event.target.value })}
              />
              <Button
                variant="outlined"
                size="s"
                disabled={busy !== null || !qqmail.address.trim() || !qqmail.authorization.trim()}
                onClick={() =>
                  void run('qqmail', async () => {
                    await connectApp('qqmail', {
                      address: qqmail.address.trim(),
                      authorization: qqmail.authorization.trim(),
                    })
                    setQqmail({ address: '', authorization: '' })
                  })
                }
              >
                {t('appsConnect')}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className={styles.provCard}>
        <div className={styles.provHead}>
          <span className={styles.appIcon}>{appIcons.qqbot}</span>
          <span className={styles.provName}>{appLabels.qqbot}</span>
          <span className={clsx(styles.tag, connected('qqbot') ? styles.tagOk : styles.tagWarn)}>
            {connected('qqbot') ? (status?.qqbot.account ?? t('appsConnected')) : t('appsNotConnected')}
          </span>
        </div>
        <AppLink href="https://q.qq.com/" label={t('appsQqbotLink')} note={t('appsQqbotNote')} />
        <AppLink href="https://bot.q.qq.com/wiki/develop/api-v2/" label={t('appsQqbotDocLink')} note={t('appsQqbotDocNote')} />
        {status?.qqbot.error ? <div className={styles.error}>{status.qqbot.error}</div> : null}
        {connected('qqbot') ? (
          <div className={styles.provActions}>
            <Button
              variant="outlined"
              size="s"
              disabled={busy !== null}
              onClick={() =>
                void run('qqbot-inbox', async () => {
                  setInbox(await qqBotInbox())
                })
              }
            >
              {t('appsQqbotInbox')}
            </Button>
            <Button
              variant="dangerOutlined"
              size="s"
              disabled={busy !== null}
              onClick={() => void run('qqbot', () => disconnectApp('qqbot'))}
            >
              {t('appsDisconnect')}
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.presetKeyRow}>
              <input
                className={styles.input}
                value={qqbot.appId}
                placeholder="AppID"
                spellCheck={false}
                onChange={(event) => setQqbot({ ...qqbot, appId: event.target.value })}
              />
            </div>
            <div className={styles.presetKeyRow}>
              <input
                className={styles.input}
                type="password"
                autoComplete="off"
                value={qqbot.secret}
                placeholder="AppSecret"
                onChange={(event) => setQqbot({ ...qqbot, secret: event.target.value })}
              />
              <Button
                variant="outlined"
                size="s"
                disabled={busy !== null || !qqbot.appId.trim() || !qqbot.secret.trim()}
                onClick={() =>
                  void run('qqbot', async () => {
                    await connectApp('qqbot', { appId: qqbot.appId.trim(), secret: qqbot.secret.trim() })
                    setQqbot({ appId: '', secret: '' })
                  })
                }
              >
                {t('appsConnect')}
              </Button>
            </div>
          </>
        )}
        {inbox ? (
          <div className={styles.appInbox}>
            {inbox.length === 0 ? <div className={styles.description}>{t('appsQqbotEmpty')}</div> : null}
            {inbox.map((message) => (
              <div key={message.id} className={styles.appInboxItem}>
                <span className={styles.tag}>{message.kind}</span>
                <span className={styles.appInboxText}>{message.text}</span>
                <Button
                  variant="outlined"
                  size="s"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('dswc-insert-draft', { detail: message.text }))
                    showToast({ key: 'appsQqbotInserted' })
                  }}
                >
                  {t('appsQqbotInsert')}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}