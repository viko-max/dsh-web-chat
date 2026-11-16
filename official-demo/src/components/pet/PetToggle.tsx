import { API_ORIGIN, PANEL_MODE } from '../../services/api/client.js'
import { setPet, useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './PetToggle.module.css'

const whaleSrc = PANEL_MODE ? `${API_ORIGIN}?asset=static/whale.svg` : 'static/whale.svg'

/** 顶栏桌宠开关：一键显示/隐藏，默认显示。 */
export const PetToggle = () => {
  const t = useTranslate()
  const pet = useSettings((state) => state.pet)
  const visible = pet !== 'hidden'
  if (!PANEL_MODE) return null
  return (
    <button
      type="button"
      className={styles.toggle}
      data-active={visible}
      aria-label={visible ? t('petToggleHide') : t('petToggleShow')}
      aria-pressed={visible}
      title={visible ? t('petToggleHide') : t('petToggleShow')}
      onClick={() => setPet(visible ? 'hidden' : 'blue-chibi')}
    >
      <img src={whaleSrc} alt="" draggable={false} />
    </button>
  )
}