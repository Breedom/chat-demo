import { create } from 'zustand'
import { getChatConnection, useSettings } from '../../services/settings.js'
import { isConnectionReady } from '../../services/providers.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'providers' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
  editProviderId: undefined as string | undefined,
}))

export const openSettings = (section: SettingsSection, editProviderId?: string) =>
  useSettingsDialog.setState({ open: true, section, editProviderId })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 缺少当前服务所需的凭据时打开模型服务设置。 */
export const ensureApiKey = () => {
  if (isConnectionReady(getChatConnection())) {
    return true
  }
  openSettings('providers')
  return false
}

export const ensureDeepSeekKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  openSettings('providers', 'deepseek')
  return false
}
