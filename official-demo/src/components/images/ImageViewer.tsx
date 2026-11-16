import { useTranslate } from '../../i18n/index.js'
import {
  IconCloseOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { deleteImage } from '../../services/images.js'
import { closeImageViewer, useImageViewer } from './imageViewerState.js'
import { openImageStudio } from './imageStudioState.js'
import { downloadImage, useObjectUrl } from './ImageMedia.js'
import styles from './ImageMedia.module.css'

/** 大图查看器：全屏遮罩 + 工具栏（编辑/下载/删除/关闭）+ 提示词说明 */
export const ImageViewer = () => {
  const t = useTranslate()
  const image = useImageViewer((state) => state.image)
  const url = useObjectUrl(image?.blob)
  if (!image) return null
  return (
    <div className={styles.viewerMask} onClick={closeImageViewer} role="dialog" aria-modal="true">
      <div className={styles.viewerBody} onClick={(event) => event.stopPropagation()}>
        <div className={styles.viewerToolbar}>
          <button
            type="button"
            className={styles.viewerTool}
            onClick={() => {
              openImageStudio(image)
              closeImageViewer()
            }}
          >
            <IconEditOutline16 />
            {t('imageEdit')}
          </button>
          <button type="button" className={styles.viewerTool} onClick={() => downloadImage(image)}>
            <IconDownloadOutline16 />
            {t('imageDownload')}
          </button>
          <button
            type="button"
            className={styles.viewerTool}
            onClick={() => {
              void deleteImage(image.id)
              closeImageViewer()
            }}
          >
            <IconTrashOutline16 />
            {t('provDelete')}
          </button>
          <button type="button" className={styles.viewerClose} onClick={closeImageViewer} aria-label={t('cancel')}>
            <IconCloseOutline16 />
          </button>
        </div>
        {url ? <img className={styles.viewerImage} src={url} alt={image.prompt} /> : null}
        <div className={styles.viewerCaption}>
          <span className={styles.viewerPrompt}>{image.prompt}</span>
          <span className={styles.viewerMeta}>
            {image.providerName} · {image.model}
          </span>
        </div>
      </div>
    </div>
  )
}