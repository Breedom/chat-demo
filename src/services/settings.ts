import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import {
  DEEPSEEK_MODEL,
  DEEPSEEK_PROVIDER,
  OPENAI_PRESET,
  OPENAI_PROVIDER,
  normalizeProvider,
  type ChatConnection,
  type CompatibleProvider,
} from './providers.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  activeProviderId: string
  compatibleProviders: CompatibleProvider[]
  compatibleKeys: ReadonlyMap<string, string>
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  activeProviderId: 'chat-demo:active-provider',
  compatibleProviders: 'chat-demo:compatible-providers',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialProviders = (): CompatibleProvider[] => {
  const providers = new Map([[OPENAI_PROVIDER, OPENAI_PRESET]])
  try {
    const saved: unknown = JSON.parse(read(KEYS.compatibleProviders) ?? '[]')
    if (Array.isArray(saved)) {
      for (const item of saved) {
        const provider = normalizeProvider(item)
        if (provider) {
          providers.set(provider.id, provider)
        }
      }
    }
  } catch {
    // 配置损坏时保留内置厂商。
  }
  return [...providers.values()]
}

export const useSettings = create<Settings>(() => {
  const compatibleProviders = initialProviders()
  const selected = read(KEYS.activeProviderId)
  return {
    apiKey: read(KEYS.apiKey),
    activeProviderId:
      compatibleProviders.find(({ id }) => id === selected)?.id ?? DEEPSEEK_PROVIDER,
    compatibleProviders,
    compatibleKeys: new Map(),
    locale: initialLocale(),
    location: initialLocation(),
    themePreference: initialThemePreference(),
    ttsVoice: initialTtsVoice(),
    thinking: read(KEYS.thinking) === 'true',
    search: read(KEYS.search) === 'true',
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  }
})

export const getChatConnection = (state = useSettings.getState()): ChatConnection => {
  const provider = state.compatibleProviders.find(({ id }) => id === state.activeProviderId)
  return provider
    ? { kind: 'compatible', provider, apiKey: state.compatibleKeys.get(provider.id) ?? null }
    : { kind: 'deepseek', model: DEEPSEEK_MODEL, apiKey: state.apiKey }
}

export const setActiveProvider = (id: string) => {
  if (
    id !== DEEPSEEK_PROVIDER &&
    !useSettings.getState().compatibleProviders.some((p) => p.id === id)
  ) {
    return
  }
  write(KEYS.activeProviderId, id)
  useSettings.setState({ activeProviderId: id })
}

export const saveCompatibleProvider = (input: CompatibleProvider, apiKey: string) => {
  const provider = normalizeProvider(input)
  if (!provider) {
    return false
  }
  const state = useSettings.getState()
  const previous = state.compatibleProviders.find(({ id }) => id === provider.id)
  const compatibleProviders = previous
    ? state.compatibleProviders.map((item) => (item.id === provider.id ? provider : item))
    : [...state.compatibleProviders, provider]
  const compatibleKeys = new Map(state.compatibleKeys)
  if (apiKey.trim()) {
    compatibleKeys.set(provider.id, apiKey.trim())
  } else {
    compatibleKeys.delete(provider.id)
  }
  write(KEYS.compatibleProviders, JSON.stringify(compatibleProviders))
  write(KEYS.activeProviderId, provider.id)
  useSettings.setState({ compatibleProviders, compatibleKeys, activeProviderId: provider.id })
  return true
}

export const removeCompatibleProvider = (id: string) => {
  if (id === OPENAI_PROVIDER) {
    return
  }
  const state = useSettings.getState()
  const compatibleProviders = state.compatibleProviders.filter((provider) => provider.id !== id)
  const compatibleKeys = new Map(state.compatibleKeys)
  compatibleKeys.delete(id)
  const activeProviderId =
    state.activeProviderId === id ? DEEPSEEK_PROVIDER : state.activeProviderId
  write(KEYS.compatibleProviders, JSON.stringify(compatibleProviders))
  write(KEYS.activeProviderId, activeProviderId)
  useSettings.setState({ compatibleProviders, compatibleKeys, activeProviderId })
}

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
