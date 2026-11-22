import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { listModelIds } from '../../services/api/openai.js'
import {
  DEEPSEEK_PROVIDER,
  OPENAI_PROVIDER,
  REASONING_EFFORTS,
  emptyModel,
  normalizeBaseUrl,
  normalizeModel,
  type CompatibleModel,
  type CompatibleProvider,
  type ReasoningChoice,
} from '../../services/providers.js'
import {
  removeCompatibleProvider,
  saveCompatibleProvider,
  setActiveProvider,
  setDeepSeekModel,
  useSettings,
} from '../../services/settings.js'
import { createId } from '../../utils/id.js'
import { Button } from '../base/Button.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { useSettingsDialog } from './settingsDialogState.js'
import styles from './Settings.module.css'

export const ProviderSettings = () => {
  const t = useTranslate()
  const activeId = useSettings((state) => state.activeProviderId)
  const providers = useSettings((state) => state.compatibleProviders)
  const preferredId = useSettingsDialog((state) => state.editProviderId)
  const [adding, setAdding] = useState<string | null>(null)
  const [editingId, setEditingId] = useState(preferredId)
  const selectedId = editingId ?? activeId
  const active = providers.find(({ id }) => id === selectedId)
  const provider = adding ? { id: adding, name: '', baseUrl: '', model: '' } : active
  return (
    <>
      <div className={styles.providerForm}>
        <label className={styles.providerField}>
          {t('providerLabel')}
          <select
            value={adding ?? selectedId}
            onChange={(event) => {
              setAdding(null)
              setEditingId(undefined)
              setActiveProvider(event.target.value)
            }}
          >
            <option value={DEEPSEEK_PROVIDER}>DeepSeek</option>
            {providers.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {adding ? <option value={adding}>{t('providerAdd')}</option> : null}
          </select>
        </label>
        {!adding ? (
          <Button size="s" variant="outlined" onClick={() => setAdding(createId())}>
            {t('providerAdd')}
          </Button>
        ) : null}
      </div>
      {provider ? (
        <CompatibleEditor
          key={provider.id}
          provider={provider}
          adding={Boolean(adding)}
          onFinish={() => {
            setAdding(null)
            setEditingId(undefined)
          }}
        />
      ) : (
        <DeepSeekKey />
      )}
    </>
  )
}

const DeepSeekKey = () => {
  const t = useTranslate()
  const editor = useApiKeyEditor()
  const savedModel = useSettings((state) => state.deepSeekModel)
  const [model, setModel] = useState(savedModel)
  const apiKey = editor.apiKey ?? ''
  return (
    <>
      <ApiKeyField editor={editor} />
      <ApiKeyConfirm editor={editor} />
      <form
        className={styles.providerForm}
        onSubmit={(event) => {
          event.preventDefault()
          setDeepSeekModel(model)
        }}
      >
        <ModelPicker model={model} setModel={setModel} baseUrl="" apiKey={apiKey} native />
        <Button size="m" type="submit" disabled={model.trim() === savedModel}>
          {t('providerSave')}
        </Button>
      </form>
    </>
  )
}

const ModelPicker = ({
  model,
  setModel,
  baseUrl,
  apiKey,
  native = false,
  saved = [],
}: {
  model: string
  setModel: (value: string) => void
  baseUrl: string
  apiKey: string
  native?: boolean
  saved?: string[]
}) => {
  const t = useTranslate()
  const [ids, setIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const listId = useId()
  useEffect(() => {
    setIds([])
    setLoading(false)
    setFeedback(null)
    return () => controller.current?.abort()
  }, [baseUrl, apiKey])

  const discover = async () => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setFeedback(null)
    try {
      const found = await listModelIds(baseUrl, apiKey, request.signal, native)
      if (request.signal.aborted) {
        return
      }
      setIds(found)
      if (found.length === 0) {
        setFeedback(t('providerModelListEmpty'))
      }
    } catch (error) {
      if (!request.signal.aborted) {
        setFeedback(
          error instanceof ApiError && error.kind === 'network'
            ? t('providerNetworkError')
            : t('providerModelListFailed', {
                message: error instanceof Error ? error.message : String(error),
              })
        )
      }
    } finally {
      if (!request.signal.aborted) {
        setLoading(false)
      }
    }
  }
  const options = [...new Set([...saved, ...ids])]
  return (
    <div className={styles.providerField}>
      <label htmlFor={listId}>{t('providerModel')}</label>
      <div className={styles.modelPicker}>
        <input
          id={listId}
          required
          value={model}
          maxLength={240}
          spellCheck={false}
          onChange={(event) => setModel(event.target.value)}
        />
        <Button size="m" variant="outlined" disabled={loading} onClick={() => void discover()}>
          {t(loading ? 'providerDiscovering' : 'providerDiscoverModels')}
        </Button>
      </div>
      {options.length ? (
        <select
          aria-label={t('providerChooseModel')}
          value={options.includes(model) ? model : ''}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="" disabled>
            {t('providerChooseModel')}
          </option>
          {options.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      ) : null}
      {feedback ? (
        <div className={styles.error} role="status">
          {feedback}
        </div>
      ) : null}
    </div>
  )
}

const CompatibleEditor = ({
  provider,
  adding,
  onFinish,
}: {
  provider: CompatibleProvider
  adding: boolean
  onFinish: () => void
}) => {
  const t = useTranslate()
  const existingKey = useSettings((state) => state.compatibleKeys.get(provider.id) ?? '')
  const [name, setName] = useState(provider.name)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl)
  const [model, setModel] = useState(provider.model)
  const [apiKey, setApiKey] = useState(existingKey)
  const [models, setModels] = useState(() => {
    const items = new Map(provider.models?.map((item) => [item.id, item]))
    if (provider.model && !items.has(provider.model)) {
      items.set(provider.model, emptyModel(provider.model))
    }
    return items
  })
  const [feedback, setFeedback] = useState<'invalid' | 'saved' | null>(null)
  const modelId = model.trim()
  const options = models.get(modelId) ?? emptyModel(modelId)
  const updateOptions = (value: CompatibleModel) => {
    const normalized = normalizeModel(value)
    if (normalized) {
      setModels((current) => new Map(current).set(modelId, normalized))
      setFeedback(null)
    }
  }
  return (
    <form
      className={styles.providerForm}
      onSubmit={(event) => {
        event.preventDefault()
        const modelOptions = new Map(models).set(modelId, options)
        if (
          saveCompatibleProvider(
            { ...provider, name, baseUrl, model, models: [...modelOptions.values()] },
            apiKey
          )
        ) {
          setFeedback('saved')
          onFinish()
        } else {
          setFeedback('invalid')
        }
      }}
    >
      {provider.id !== OPENAI_PROVIDER ? (
        <label className={styles.providerField}>
          {t('providerName')}
          <input
            required
            value={name}
            maxLength={80}
            onChange={(event) => {
              setFeedback(null)
              setName(event.target.value)
            }}
          />
        </label>
      ) : null}
      <label className={styles.providerField}>
        {t('providerBaseUrl')}
        <input
          required
          type="url"
          value={baseUrl}
          placeholder="https://example.com/v1"
          spellCheck={false}
          onChange={(event) => {
            if (normalizeBaseUrl(baseUrl) !== normalizeBaseUrl(event.target.value)) {
              setApiKey('')
              setModels(new Map())
            }
            setFeedback(null)
            setBaseUrl(event.target.value)
          }}
        />
      </label>
      <label className={styles.providerField}>
        API Key
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setFeedback(null)
            setApiKey(event.target.value)
          }}
        />
      </label>
      <div className={styles.description}>{t('providerKeyWarning')}</div>
      <ModelPicker
        model={model}
        setModel={(value) => {
          setModel(value)
          setFeedback(null)
        }}
        baseUrl={baseUrl}
        apiKey={apiKey}
        saved={Array.from(models.keys())}
      />
      <fieldset disabled={!modelId} className={styles.modelFeatures}>
        <legend>{t('providerModelInputs')}</legend>
        {(['images', 'videos', 'files'] as const).map((kind) => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={options[kind]}
              onChange={(event) => updateOptions({ ...options, [kind]: event.target.checked })}
            />
            {t(
              kind === 'images'
                ? 'providerImages'
                : kind === 'videos'
                  ? 'providerVideos'
                  : 'providerFiles'
            )}
          </label>
        ))}
      </fieldset>
      <fieldset disabled={!modelId} className={styles.modelFeatures}>
        <legend>{t('providerReasoningLevels')}</legend>
        {REASONING_EFFORTS.map((effort) => (
          <label key={effort}>
            <input
              type="checkbox"
              checked={options.efforts.includes(effort)}
              onChange={(event) =>
                updateOptions({
                  ...options,
                  efforts: event.target.checked
                    ? [...options.efforts, effort]
                    : options.efforts.filter((value) => value !== effort),
                })
              }
            />
            {t(`reasoning_${effort}`)}
          </label>
        ))}
      </fieldset>
      <label className={styles.providerField}>
        {t('providerDefaultReasoning')}
        <select
          disabled={!options.efforts.length}
          value={options.defaultEffort}
          onChange={(event) =>
            updateOptions({ ...options, defaultEffort: event.target.value as ReasoningChoice })
          }
        >
          <option value="default">{t('reasoning_default')}</option>
          {options.efforts.map((effort) => (
            <option key={effort} value={effort}>
              {t(`reasoning_${effort}`)}
            </option>
          ))}
        </select>
      </label>
      {feedback === 'invalid' ? (
        <div className={styles.error} role="alert">
          {t('providerInvalid')}
        </div>
      ) : null}
      {feedback === 'saved' ? (
        <div className={styles.description} role="status">
          {t('providerSaved')}
        </div>
      ) : null}
      <div className={styles.providerActions}>
        <Button size="m" type="submit">
          {t('providerSave')}
        </Button>
        {adding ? (
          <Button size="m" variant="outlined" onClick={onFinish}>
            {t('cancel')}
          </Button>
        ) : null}
        {!adding && provider.id !== OPENAI_PROVIDER ? (
          <Button
            size="m"
            variant="dangerOutlined"
            onClick={() => removeCompatibleProvider(provider.id)}
          >
            {t('delete')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
