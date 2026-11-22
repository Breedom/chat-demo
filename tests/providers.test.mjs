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

const { normalizeBaseUrl, OPENAI_PRESET, isConnectionReady } =
  await import('../.cache/test-build/src/services/providers.js')
const { getChatConnection, saveCompatibleProvider, removeCompatibleProvider, setActiveProvider } =
  await import('../.cache/test-build/src/services/settings.js')
const { streamOpenAI } = await import('../.cache/test-build/src/services/api/openai.js')
const { streamMessage } = await import('../.cache/test-build/src/services/api/client.js')
const { applyEvent, toOpenAIRequestMessages } =
  await import('../.cache/test-build/src/services/chat/reply.js')

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
