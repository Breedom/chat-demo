import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  DEEPSEEK_PROVIDER,
  OPENAI_PROVIDER,
  normalizeBaseUrl,
  type CompatibleProvider,
} from '../../services/providers.js'
import {
  removeCompatibleProvider,
  saveCompatibleProvider,
  setActiveProvider,
  useSettings,
} from '../../services/settings.js'
import { createId } from '../../utils/id.js'
import { Button } from '../base/Button.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import styles from './Settings.module.css'

export const ProviderSettings = () => {
  const t = useTranslate()
  const activeId = useSettings((state) => state.activeProviderId)
  const providers = useSettings((state) => state.compatibleProviders)
  const [adding, setAdding] = useState<string | null>(null)
  const active = providers.find(({ id }) => id === activeId)
  const provider = adding ? { id: adding, name: '', baseUrl: '', model: '' } : active
  return (
    <>
      <div className={styles.providerForm}>
        <label className={styles.providerField}>
          {t('providerLabel')}
          <select
            value={adding ?? activeId}
            onChange={(event) => {
              setAdding(null)
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
          onFinish={() => setAdding(null)}
        />
      ) : (
        <DeepSeekKey />
      )}
    </>
  )
}

const DeepSeekKey = () => {
  const editor = useApiKeyEditor()
  return (
    <>
      <ApiKeyField editor={editor} />
      <ApiKeyConfirm editor={editor} />
    </>
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
  const [feedback, setFeedback] = useState<'invalid' | 'saved' | null>(null)
  return (
    <form
      className={styles.providerForm}
      onSubmit={(event) => {
        event.preventDefault()
        if (saveCompatibleProvider({ ...provider, name, baseUrl, model }, apiKey)) {
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
            }
            setFeedback(null)
            setBaseUrl(event.target.value)
          }}
        />
      </label>
      <label className={styles.providerField}>
        {t('providerModel')}
        <input
          required
          value={model}
          maxLength={240}
          spellCheck={false}
          onChange={(event) => {
            setFeedback(null)
            setModel(event.target.value)
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
