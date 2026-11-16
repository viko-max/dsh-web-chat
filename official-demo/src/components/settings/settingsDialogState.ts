import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用 / 个性化 / 对话服务商 / 图像服务 / 连接应用 / 自动化 / 数据管理 */
export type SettingsSection = 'general' | 'personalization' | 'providers' | 'images' | 'apps' | 'automation' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开设置并选中 Key 所在分组，返回是否已有 Key。面板模式 Key 由 Host 托管，恒为已有。 */
export const ensureApiKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  openSettings('data')
  return false
}