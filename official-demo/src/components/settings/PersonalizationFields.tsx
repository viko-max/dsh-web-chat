import { Select } from '../base/Select.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  personalizationKeys,
  personalizationOptions,
  type Personalization,
  type PersonalizationKey,
} from '../../services/personalization.js'
import styles from './Personalization.module.css'

const dimensionLabels: Record<PersonalizationKey, TranslationKey> = {
  tone: 'persTone',
  warmth: 'persWarmth',
  enthusiasm: 'persEnthusiasm',
  emoji: 'persEmoji',
  visual: 'persVisual',
  structure: 'persStructure',
}

const dimensionHints: Record<PersonalizationKey, TranslationKey> = {
  tone: 'persToneHint',
  warmth: 'persWarmthHint',
  enthusiasm: 'persEnthusiasmHint',
  emoji: 'persEmojiHint',
  visual: 'persVisualHint',
  structure: 'persStructureHint',
}

/** 六个个性化维度下拉（全局设置与会话覆盖共用） */
export const PersonalizationFields = ({
  value,
  onChange,
  showHints = false,
}: {
  value: Personalization
  onChange: (next: Personalization) => void
  showHints?: boolean
}) => {
  const t = useTranslate()
  return (
    <div className={styles.fields}>
      {personalizationKeys.map((key) => (
        <div key={key} className={styles.row}>
          <div className={styles.text}>
            <span className={styles.label}>{t(dimensionLabels[key])}</span>
            {showHints ? <span className={styles.hint}>{t(dimensionHints[key])}</span> : null}
          </div>
          <Select
            ariaLabel={t(dimensionLabels[key])}
            className={styles.select}
            value={value[key]}
            options={personalizationOptions[key].map((option) => ({
              value: option.value,
              label: t(option.label as TranslationKey),
            }))}
            onChange={(next) => onChange({ ...value, [key]: next })}
          />
        </div>
      ))}
    </div>
  )
}