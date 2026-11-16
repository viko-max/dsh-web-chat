import { create } from 'zustand'

export const useExportDialog = create<{ open: boolean }>(() => ({ open: false }))
export const openExportDialog = () => useExportDialog.setState({ open: true })
export const closeExportDialog = () => useExportDialog.setState({ open: false })