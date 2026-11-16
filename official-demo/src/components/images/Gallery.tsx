import { useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16, IconDownloadOutline16, IconEditOutline16, IconSearchOutline16, IconTrashOutline16 } from '../base/icons.js'
import { deleteImage, useImages, type GeneratedImage } from '../../services/images.js'
import { closeGallery, openImageViewer, useImageViewer } from './imageViewerState.js'
import { openImageStudio } from './imageStudioState.js'
import { downloadImage, useObjectUrl } from './ImageMedia.js'
import styles from './ImageMedia.module.css'

const GalleryCard = ({ image }: { image: GeneratedImage }) => {
  const t = useTranslate()
  const url = useObjectUrl(image.blob)
  return (
    <div className={styles.galleryCard}>
      <button type="button" className={styles.galleryImageBtn} onClick={() => openImageViewer(image)}>
        {url ? <img className={styles.galleryImage} src={url} alt={image.prompt} loading="lazy" /> : null}
      </button>
      <div className={styles.galleryInfo}>
        <span className={styles.galleryPrompt}>{image.prompt}</span>
        <span className={styles.galleryMeta}>{image.providerName}</span>
      </div>
      <div className={styles.galleryActions}>
        <button type="button" onClick={() => openImageStudio(image)} title={t('imageEdit')} aria-label={t('imageEdit')}>
          <IconEditOutline16 />
        </button>
        <button type="button" onClick={() => downloadImage(image)} title={t('imageDownload')} aria-label={t('imageDownload')}>
          <IconDownloadOutline16 />
        </button>
        <button type="button" onClick={() => void deleteImage(image.id)} title={t('provDelete')} aria-label={t('provDelete')}>
          <IconTrashOutline16 />
        </button>
      </div>
    </div>
  )
}

/** 我的图库：全部生成图像，搜索 + 网格 + 编辑/下载/删除 */
export const Gallery = () => {
  const t = useTranslate()
  const open = useImageViewer((state) => state.galleryOpen)
  const images = useImages((state) => state.images)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? images.filter((image) => image.prompt.toLowerCase().includes(q)) : images
  }, [images, query])
  if (!open) return null
  return (
    <div className={styles.viewerMask} onClick={closeGallery} role="dialog" aria-modal="true">
      <div className={styles.galleryBody} onClick={(event) => event.stopPropagation()}>
        <div className={styles.galleryHead}>
          <span className={styles.galleryTitle}>{t('imageGallery')}</span>
          <div className={styles.gallerySearch}>
            <IconSearchOutline16 />
            <input
              value={query}
              placeholder={t('imageGallerySearch')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <span className={styles.galleryCount}>{filtered.length}</span>
          <button type="button" className={styles.viewerClose} onClick={closeGallery} aria-label={t('cancel')}>
            <IconCloseOutline16 />
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className={styles.galleryEmpty}>{t('imageGalleryEmpty')}</div>
        ) : (
          <div className={styles.galleryGrid}>
            {filtered.map((image) => (
              <GalleryCard key={image.id} image={image} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}