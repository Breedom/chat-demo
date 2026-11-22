import assert from 'node:assert/strict'
import { test } from 'node:test'

const storage = new Map([['chat-demo:api-key', 'deepseek-test-key']])
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
})
globalThis.__API_ORIGIN__ = 'https://deepseek.example'

const { normalizeBaseUrl, OPENAI_PRESET, isConnectionReady, attachmentScope, getModelOptions } =
  await import('../.cache/test-build/src/services/providers.js')
const {
  getChatConnection,
  saveCompatibleProvider,
  removeCompatibleProvider,
  setActiveProvider,
  selectCompatibleModel,
  setReasoningChoice,
} = await import('../.cache/test-build/src/services/settings.js')
const { streamOpenAI, listModelIds } =
  await import('../.cache/test-build/src/services/api/openai.js')
const { streamMessage } = await import('../.cache/test-build/src/services/api/client.js')
const { applyEvent, toOpenAIRequestMessages } =
  await import('../.cache/test-build/src/services/chat/reply.js')
const { prepareCompatibleContent, validateCompatibleFiles } =
  await import('../.cache/test-build/src/services/chat/compatibleFiles.js')
const { addDraftFiles, getDraft, prepareDraftMessage, clearDraft } =
  await import('../.cache/test-build/src/services/chat/drafts.js')

const connection = {
  kind: 'compatible',
  provider: { ...OPENAI_PRESET, model: 'test-model' },
  apiKey: 'openai-test-key',
}
const question = { id: 'q', content: 'Hello', role: 'user', files: [], createdAt: 0 }
const messages = [{ role: 'user', content: 'Hello' }]
const collect = async (events) => {
  const result = []
  for await (const event of events) {
    result.push(event)
  }
  return result
}
const response = (frames) =>
  new Response(
    frames
      .map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\r\n\r\n`)
      .join(''),
    {
      headers: { 'Content-Type': 'text/event-stream' },
    }
  )

const mediaProvider = {
  id: 'media',
  name: 'Media API',
  model: 'vision',
  baseUrl: 'https://media.example/v1',
  models: [
    {
      id: 'vision',
      images: true,
      videos: true,
      files: true,
      efforts: ['low', 'high'],
      defaultEffort: 'low',
    },
    { id: 'text', images: false, efforts: ['medium'], defaultEffort: 'medium' },
  ],
}

test('fetches model IDs from unsaved settings, deduplicates and validates the response', async (t) => {
  let valid = true
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://models.example/gateway/v1/models')
    assert.equal(init.headers.Authorization, 'Bearer temporary-key')
    assert.equal(init.redirect, 'error')
    return Response.json(
      valid ? { data: [{ id: 'z' }, { id: 'a' }, { id: ' z ' }, { id: 1 }] } : {}
    )
  })
  const signal = new AbortController().signal
  const fetchIds = () =>
    listModelIds('https://models.example/gateway/v1/models', ' temporary-key ', signal)
  assert.deepEqual(await fetchIds(), ['a', 'z'])
  valid = false
  await assert.rejects(fetchIds, { kind: 'protocol' })
  await assert.rejects(() => listModelIds('https://api.openai.com/v1', '', signal), {
    kind: 'protocol',
  })
})

test('separates capabilities and chat reasoning overrides by model', async (t) => {
  assert.ok(saveCompatibleProvider(mediaProvider, ''))
  assert.equal(getChatConnection().reasoningEffort, 'low')
  setReasoningChoice(mediaProvider, 'high')
  selectCompatibleModel('media', 'text')
  const text = getChatConnection()
  assert.equal(text.reasoningEffort, 'medium')
  assert.equal(getModelOptions(text.provider).images, false)
  selectCompatibleModel('media', 'vision')
  const vision = getChatConnection()
  assert.equal(vision.reasoningEffort, 'high')
  let body
  t.mock.method(globalThis, 'fetch', async (_, init) => {
    body = JSON.parse(init.body)
    return response([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }, '[DONE]'])
  })
  await collect(streamOpenAI(vision, messages, new AbortController().signal))
  assert.equal(body.reasoning_effort, 'high')
  setReasoningChoice(mediaProvider, 'default')
  await collect(streamOpenAI(getChatConnection(), messages, new AbortController().signal))
  assert.ok(!Object.hasOwn(body, 'reasoning_effort'))
  removeCompatibleProvider('media')
})

test('stages compatible files locally and encodes supported attachments in the request', async (t) => {
  const conn = { kind: 'compatible', provider: mediaProvider, apiKey: null }
  const mock = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Unexpected upload')
  })
  const files = [
    new File(['png'], 'sample.png'),
    new File(['movie'], 'sample.mp4'),
    new File(['pdf'], 'sample.pdf'),
    new File(['你好'], 'sample.txt'),
  ]
  assert.equal(addDraftFiles('media-test', files, conn), null)
  assert.equal(mock.mock.callCount(), 0)
  const prepared = prepareDraftMessage(getDraft('media-test'), {}, conn)
  assert.equal(prepared.files.length, 4)
  assert.ok(prepared.files.every((file) => file.serverId === null))
  const blobs = new Map(prepared.files.map(({ id, blob }) => [id, blob]))
  const current = {
    ...question,
    files: prepared.files.map((file) => ({
      ...file,
      compatibleScope: attachmentScope(mediaProvider),
    })),
  }
  const converted = await prepareCompatibleContent(
    mediaProvider,
    [],
    current,
    async (id) => blobs.get(id),
    new AbortController().signal
  )
  assert.deepEqual(converted.current, [
    { type: 'text', text: question.content },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,cG5n' } },
    { type: 'video_url', video_url: { url: 'data:video/mp4;base64,bW92aWU=' } },
    {
      type: 'file',
      file: { filename: 'sample.pdf', file_data: 'data:application/pdf;base64,cGRm' },
    },
    { type: 'text', text: 'sample.txt:\n你好' },
  ])
  assert.equal(
    validateCompatibleFiles(current.files, getModelOptions({ ...mediaProvider, model: 'text' }))
      .key,
    'providerAttachmentsUnsupported'
  )
  clearDraft('media-test')
})

test('keeps mismatched and restored attachments out of other providers’ requests', async () => {
  const original = { ...mediaProvider, baseUrl: 'https://old.example/v1' }
  const file = {
    id: 'private',
    name: 'private.png',
    size: 1,
    mimeType: 'image/png',
    compatibleScope: attachmentScope(original),
  }
  const previous = [
    { content: 'Only this text', files: [file] },
    { content: '', files: [{ ...file, compatibleScope: '' }] },
  ]
  const load = async () => {
    throw new Error('Should not read another provider’s attachment')
  }
  const signal = new AbortController().signal
  const converted = await prepareCompatibleContent(mediaProvider, previous, question, load, signal)
  assert.deepEqual(converted.history, ['Only this text', ''])
  await assert.rejects(
    () => prepareCompatibleContent(mediaProvider, [], { ...question, files: [file] }, load, signal),
    { kind: 'protocol' }
  )
})

test('validates base URLs and keeps each compatible key out of persistent settings', () => {
  assert.equal(
    normalizeBaseUrl(' https://example.com/v1/chat/completions/ '),
    'https://example.com/v1'
  )
  assert.equal(normalizeBaseUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1')
  for (const url of [
    'http://example.com',
    'https://name:password@example.com',
    'https://example.com?v=1',
    'https://example.com/#x',
    'javascript:alert(1)',
  ]) {
    assert.equal(normalizeBaseUrl(url), null)
  }
  assert.equal(getChatConnection().apiKey, 'deepseek-test-key')
  setActiveProvider('openai')
  assert.equal(isConnectionReady(getChatConnection()), false)
  assert.equal(saveCompatibleProvider(connection.provider, connection.apiKey), true)
  assert.equal(getChatConnection().apiKey, connection.apiKey)
  const custom = {
    id: 'custom',
    name: 'Custom',
    model: 'test',
    baseUrl: 'http://localhost:1234/v1',
  }
  assert.equal(saveCompatibleProvider(custom, ''), true)
  assert.equal(isConnectionReady(getChatConnection()), true)
  assert.equal(getChatConnection().apiKey, null)
  assert.ok(!storage.get('chat-demo:compatible-providers').includes(connection.apiKey))
  setActiveProvider('openai')
  assert.equal(getChatConnection().apiKey, connection.apiKey)
  setActiveProvider('custom')
  removeCompatibleProvider('custom')
  assert.equal(getChatConnection().apiKey, 'deepseek-test-key')
})

test('builds only text context for compatible requests', () => {
  const previous = {
    role: 'assistant',
    status: 'done',
    latestReminder: 'private location',
    blocks: [
      { type: 'thinking', thinking: 'hidden reasoning' },
      { type: 'text', text: 'Previous reply' },
    ],
  }
  const file = { serverId: 'deepseek-file-id' }
  assert.deepEqual(
    toOpenAIRequestMessages(
      [
        { ...question, content: '', files: [file] },
        previous,
        { ...question, content: 'Previous question', files: [file] },
        previous,
      ],
      question
    ),
    [
      { role: 'user', content: 'Previous question' },
      { role: 'assistant', content: 'Previous reply' },
      ...messages,
    ]
  )
})

test('sends only Chat Completions fields and maps streamed text and reasoning', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions')
    assert.equal(init.headers.Authorization, 'Bearer openai-test-key')
    assert.equal(init.redirect, 'error')
    assert.deepEqual(JSON.parse(init.body), { model: 'test-model', messages, stream: true })
    return response([
      { id: 'test', choices: [{ index: 0, delta: { role: 'assistant' } }] },
      { choices: [{ index: 0, delta: { reasoning_content: 'thinking' } }] },
      { choices: [{ index: 0, delta: { content: 'Hel' } }] },
      { choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'length' }] },
      { choices: [] },
      '[DONE]',
    ])
  })
  const events = await collect(streamOpenAI(connection, messages, new AbortController().signal))
  const blockIndexes = new Map()
  const result = events.reduce((reply, event) => applyEvent(reply, event, 1, blockIndexes), {
    status: 'pending',
    blocks: [],
  })
  assert.deepEqual(
    result.blocks.map((block) => block.text ?? block.thinking),
    ['thinking', 'Hello']
  )
  assert.equal(result.stopReason, 'max_tokens')
  assert.equal(events.at(-1).type, 'message_stop')
})

test('reports upstream errors and premature EOF; omits Authorization for an unkeyed proxy', async (t) => {
  let result = new Response(JSON.stringify({ error: { message: 'Invalid key' } }), { status: 401 })
  const proxy = {
    ...connection,
    apiKey: null,
    provider: { ...connection.provider, baseUrl: 'https://proxy.example/v1' },
  }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://proxy.example/v1/chat/completions')
    assert.equal(init.headers.Authorization, undefined)
    return result
  })
  const send = () => collect(streamOpenAI(proxy, messages, new AbortController().signal))
  await assert.rejects(send, { kind: 'http', status: 401, message: 'Invalid key' })
  result = response([{ error: { message: 'Busy' } }])
  await assert.rejects(send, { kind: 'stream', message: 'Busy' })
  result = response([{ choices: [{ delta: { content: 'unfinished' } }] }])
  await assert.rejects(send, { kind: 'interrupted' })
})

test('cancels the SSE reader when the compatible request is stopped', async (t) => {
  let canceled = false
  const controller = new AbortController()
  const stream = new ReadableStream({
    start: (sink) =>
      sink.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n')),
    cancel: () => {
      canceled = true
    },
  })
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  )
  const events = streamOpenAI(connection, messages, controller.signal)
  assert.equal((await events.next()).value.type, 'message_start')
  controller.abort()
  await assert.rejects(collect(events), { name: 'AbortError' })
  assert.equal(canceled, true)
})

test('preserves DeepSeek endpoint, credentials, and extensions', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://deepseek.example/anthropic/v1/messages')
    assert.equal(init.headers['x-api-key'], 'deepseek-test-key')
    const { stream, tools, safety_check: safetyCheck } = JSON.parse(init.body)
    assert.equal(stream, true)
    assert.deepEqual(tools, [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }])
    assert.deepEqual(safetyCheck, { level: 'high' })
    return response([{ type: 'message_stop' }])
  })
  const events = await collect(
    streamMessage(
      'deepseek-test-key',
      {
        model: 'deepseek-flash',
        messages,
        thinking: { type: 'enabled' },
        tools: [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }],
        safety_check: { level: 'high' },
      },
      new AbortController().signal
    )
  )
  assert.deepEqual(events, [{ type: 'message_stop' }])
})
