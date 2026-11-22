export const DEEPSEEK_PROVIDER = 'deepseek'
export const DEEPSEEK_MODEL = 'deepseek-flash'
export const OPENAI_PROVIDER = 'openai'
export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export type CompatibleProvider = {
  id: string
  name: string
  baseUrl: string
  model: string
}

export const OPENAI_PRESET: CompatibleProvider = {
  id: OPENAI_PROVIDER,
  name: 'OpenAI',
  baseUrl: OPENAI_BASE_URL,
  model: 'gpt-4.1-mini',
}

export type ChatConnection =
  | { kind: 'deepseek'; model: string; apiKey: string | null }
  | { kind: 'compatible'; provider: CompatibleProvider; apiKey: string | null }

export const isOfficialOpenAI = (baseUrl: string) => new URL(baseUrl).hostname === 'api.openai.com'

export const normalizeBaseUrl = (value: string): string | null => {
  try {
    const url = new URL(value.trim())
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username ||
      url.password ||
      url.href.includes('?') ||
      url.href.includes('#')
    ) {
      return null
    }
    return url.origin + url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
  } catch {
    return null
  }
}

export const normalizeProvider = (value: unknown): CompatibleProvider | null => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.id === DEEPSEEK_PROVIDER ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    !('model' in value) ||
    typeof value.model !== 'string' ||
    !value.model.trim() ||
    !('baseUrl' in value) ||
    typeof value.baseUrl !== 'string'
  ) {
    return null
  }
  const baseUrl = normalizeBaseUrl(value.baseUrl)
  if (!baseUrl) {
    return null
  }
  return {
    id: value.id,
    name: value.id === OPENAI_PROVIDER ? OPENAI_PRESET.name : value.name.trim(),
    model: value.model.trim(),
    baseUrl,
  }
}

export const isConnectionReady = (connection: ChatConnection): boolean =>
  connection.kind === 'deepseek'
    ? Boolean(connection.apiKey)
    : Boolean(connection.apiKey) || !isOfficialOpenAI(connection.provider.baseUrl)
