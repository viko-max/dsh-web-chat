import { useEffect, useState } from 'react'
import { useSettings } from '../../services/settings.js'
import { getBackgroundUrl } from '../../services/background.js'
import styles from './BackgroundLayer.module.css'

/** 自定义背景：图片层 + 可读性遮罩（毛玻璃/亚克力/透明由不透明度与模糊控制） */
export const BackgroundLayer = () => {
  const effect = useSettings((state) => state.bgEffect)
  const blur = useSettings((state) => state.bgBlur)
  const opacity = useSettings((state) => state.bgOpacity)
  const imageId = useSettings((state) => state.bgImageId)
  const [url, setUrl] = useState('')

  useEffect(() => {
    let alive = true
    let objectUrl = ''
    if (imageId && effect !== 'none') {
      void getBackgroundUrl(imageId).then((result) => {
        if (alive && result) {
          objectUrl = result
          setUrl(result)
        }
      })
    } else {
      setUrl('')
    }
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageId, effect])

  if (!url || effect === 'none') return null

  return (
    <>
      <div className={styles.image} style={{ backgroundImage: `url(${url})` }} aria-hidden="true" />
      <div
        className={styles.scrim}
        style={{ opacity, backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)` }}
        aria-hidden="true"
      />
    </>
  )
}