import { useEffect, useState } from 'react'
import { getImageById, type GeneratedImage } from '../../services/images.js'

/** 管理 object URL 生命周期 */
export const useObjectUrl = (blob: Blob | null | undefined): string => {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) {
      setUrl('')
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])
  return url
}

/** 按 imageId 加载图像（内存优先，回退 IndexedDB） */
export const useImageById = (imageId: string): GeneratedImage | null => {
  const [image, setImage] = useState<GeneratedImage | null>(null)
  useEffect(() => {
    let alive = true
    void getImageById(imageId).then((result) => {
      if (alive) setImage(result)
    })
    return () => {
      alive = false
    }
  }, [imageId])
  return image
}

export const downloadImage = (image: GeneratedImage) => {
  const url = URL.createObjectURL(image.blob)
  const link = document.createElement('a')
  link.href = url
  const ext = image.blob.type === 'image/jpeg' ? 'jpg' : image.blob.type === 'image/webp' ? 'webp' : 'png'
  link.download = `image-${image.id.slice(0, 8)}.${ext}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}