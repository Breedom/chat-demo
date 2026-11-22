export const DEEPSEEK_PROVIDER = 'deepseek'
export const DEEPSEEK_MODEL = 'deepseek-flash'
export const OPENAI_PROVIDER = 'openai'
export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
export type ReasoningChoice = 'default' | ReasoningEffort
export type CompatibleModel = {
  id: string
  images: boolean
  videos: boolean
  files: boolean
  efforts: ReasoningEffort[]
  defaultEffort: ReasoningChoice
}

export const emptyModel = (id: string): CompatibleModel => ({
  id,
  images: false,
  videos: false,
  files: false,
  efforts: [],
  defaultEffort: 'default',
})

export const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  REASONING_EFFORTS.some((effort) => effort === value)

export const normalizeModel = (value: unknown): CompatibleModel | null => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !value.id.trim()
  ) {
    return null
  }
  const options = value as Partial<CompatibleModel>
  const efforts = REASONING_EFFORTS.filter(
    (effort) => Array.isArray(options.efforts) && options.efforts.includes(effort)
  )
  return {
    id: value.id.trim(),
    images: options.images === true,
    videos: options.videos === true,
    files: options.files === true,
    efforts,
    defaultEffort:
      isReasoningEffort(options.defaultEffort) && efforts.includes(options.defaultEffort)
        ? options.defaultEffort
        : 'default',
  }
}

export type CompatibleProvider = {
  id: string
  name: string
  baseUrl: string
  model: string
  models?: CompatibleModel[]
}

export const OPENAI_PRESET: CompatibleProvider = {
  id: OPENAI_PROVIDER,
  name: 'OpenAI',
  baseUrl: OPENAI_BASE_URL,
  model: 'gpt-4.1-mini',
}

export type ChatConnection =
  | { kind: 'deepseek'; model: string; apiKey: string | null }
  | {
      kind: 'compatible'
      provider: CompatibleProvider
      apiKey: string | null
      reasoningEffort?: ReasoningEffort
    }

export const getModelOptions = (provider: CompatibleProvider): CompatibleModel =>
  provider.models?.find(({ id }) => id === provider.model) ?? emptyModel(provider.model)

export const attachmentScope = (provider: CompatibleProvider): string =>
  JSON.stringify([provider.id, provider.baseUrl])

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
    return (
      url.origin + url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/, '')
    )
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
  const models = new Map<string, CompatibleModel>()
  if ('models' in value && Array.isArray(value.models)) {
    for (const item of value.models) {
      const model = normalizeModel(item)
      if (model) {
        models.set(model.id, model)
      }
    }
  }
  return {
    id: value.id,
    name: value.id === OPENAI_PROVIDER ? OPENAI_PRESET.name : value.name.trim(),
    model: value.model.trim(),
    baseUrl,
    ...(models.size ? { models: [...models.values()] } : {}),
  }
}

export const isConnectionReady = (connection: ChatConnection): boolean =>
  connection.kind === 'deepseek'
    ? Boolean(connection.apiKey)
    : Boolean(connection.apiKey) || !isOfficialOpenAI(connection.provider.baseUrl)
