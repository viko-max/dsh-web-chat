import { useTranslate } from '../../i18n/index.js'
import { IconDownloadOutline16, IconEditOutline16 } from '../base/icons.js'
import type { GeneratedImageBlock } from '../../services/chat/types.js'
import { openImageStudio } from './imageStudioState.js'
import { openImageViewer } from './imageViewerState.js'
import { downloadImage, useImageById, useObjectUrl } from './ImageMedia.js'
import styles from './ImageMedia.module.css'

/** 聊天内生成图像卡片（ChatGPT 式）：悬停显示编辑/下载，点击看大图 */
export const ImageCard = ({ block }: { block: GeneratedImageBlock }) => {
  const t = useTranslate()
  const image = useImageById(block.imageId)
  const url = useObjectUrl(image?.blob)
  return (
    <div className={styles.card}>
      {url ? (
        <button
          type="button"
          className={styles.cardImageBtn}
          onClick={() => image && openImageViewer(image)}
          aria-label={t('imageOpenLarge')}
        >
          <img className={styles.cardImage} src={url} alt={block.prompt} loading="lazy" />
        </button>
      ) : (
        <div className={styles.cardSkeleton} aria-busy="true" />
      )}
      {image ? (
        <div className={styles.cardOverlay}>
          <button type="button" className={styles.cardEdit} onClick={() => openImageStudio(image)}>
            <IconEditOutline16 />
            {t('imageEdit')}
          </button>
          <button
            type="button"
            className={styles.cardIcon}
            onClick={() => downloadImage(image)}
            aria-label={t('imageDownload')}
            title={t('imageDownload')}
          >
            <IconDownloadOutline16 />
          </button>
        </div>
      ) : null}
    </div>
  )
}