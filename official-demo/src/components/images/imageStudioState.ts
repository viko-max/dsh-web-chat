import { create } from 'zustand'
import type { GeneratedImage } from '../../services/images.js'

type ImageStudioState = {
  open: boolean
  /** 编辑来源：带入参考图与提示词 */
  editSource: GeneratedImage | null
}

export const useImageStudio = create<ImageStudioState>(() => ({ open: false, editSource: null }))

export const openImageStudio = (editSource: GeneratedImage | null = null) =>
  useImageStudio.setState({ open: true, editSource })

export const closeImageStudio = () => useImageStudio.setState({ open: false, editSource: null })