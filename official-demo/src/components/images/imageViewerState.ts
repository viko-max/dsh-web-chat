import { create } from 'zustand'
import type { GeneratedImage } from '../../services/images.js'

type ImageViewerState = {
  image: GeneratedImage | null
  galleryOpen: boolean
}

export const useImageViewer = create<ImageViewerState>(() => ({ image: null, galleryOpen: false }))

export const openImageViewer = (image: GeneratedImage) => useImageViewer.setState({ image })
export const closeImageViewer = () => useImageViewer.setState({ image: null })
export const openGallery = () => useImageViewer.setState({ galleryOpen: true })
export const closeGallery = () => useImageViewer.setState({ galleryOpen: false })