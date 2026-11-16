import { useEffect } from 'react'
import { Select } from '../base/Select.js'
import { useTranslate } from '../../i18n/index.js'
import { PANEL_MODE } from '../../services/api/client.js'
import {
  refreshPanelModels,
  selectModel,
  selectSessionModel,
  usePanelModels,
} from '../../services/panelModels.js'
import styles from './ModelPicker.module.css'

/**
 * 模型选择胶囊：欢迎页选择作为新对话默认；会话内选择只影响该会话后续回复。
 * 仅面板模式渲染。
 */
export const ModelPicker = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const catalog = usePanelModels((state) => state.catalog)
  const selection = usePanelModels((state) =>
    sessionId ? state.sessionSelections[sessionId] ?? state.selection : state.selection
  )
  const loading = usePanelModels((state) => state.loading)

  useEffect(() => {
    if (PANEL_MODE) void refreshPanelModels()
  }, [])

  if (!PANEL_MODE) return null

  const value = `${selection.provider}\u0000${selection.model}`
  const options = catalog.map((item) => ({
    value: `${item.provider}\u0000${item.model}`,
    label: item.name,
  }))
  const current = catalog.find(
    (item) => item.provider === selection.provider && item.model === selection.model
  )

  return (
    <div className={styles.picker}>
      <Select
        ariaLabel={t('modelPickerLabel')}
        className={styles.trigger}
        value={value}
        placeholder={loading ? t('modelPickerLoading') : t('modelPickerLabel')}
        options={options}
        onChange={(next) => {
          const [provider, model] = next.split('\u0000')
          const chosen = { provider, model }
          if (sessionId) selectSessionModel(sessionId, chosen)
          else selectModel(chosen)
        }}
      />
      {current?.custom ? <span className={styles.badge}>{t('modelPickerCustom')}</span> : null}
    </div>
  )
}