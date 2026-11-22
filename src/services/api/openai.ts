import type { ChatConnection } from '../providers.js'
import { ApiError, isErrorBody, readErrorResponse, request } from './client.js'
import { readServerSentEvents } from './sse.js'
import type { MessageStreamEvent, StopReason } from './types.js'

export type OpenAIMessage = { role: 'user' | 'assistant'; content: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stopReason = (value: string): StopReason => {
  switch (value) {
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}

export async function* streamOpenAI(
  { provider, apiKey }: Extract<ChatConnection, { kind: 'compatible' }>,
  messages: OpenAIMessage[],
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model: provider.model, messages, stream: true }),
    credentials: 'omit',
    redirect: 'error',
    signal,
  })
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', 'Expected an SSE response')
  }

  let index = -1
  let current: 'text' | 'thinking' | null = null
  let reason: StopReason | undefined
  let refused = false
  let started = false
  let sawDone = false
  for await (const { event, data } of readServerSentEvents(response.body, signal)) {
    signal.throwIfAborted()
    if (event !== 'error' && data.trim() === '[DONE]') {
      sawDone = true
      break
    }
    let chunk: unknown
    try {
      chunk = JSON.parse(data)
    } catch {
      if (event === 'error') {
        throw new ApiError('stream', data)
      }
      throw new ApiError('protocol', 'Invalid JSON in the chat completion stream')
    }
    if (isErrorBody(chunk)) {
      throw new ApiError('stream', chunk.error.message)
    }
    if (event === 'error' || (isRecord(chunk) && chunk.error)) {
      throw new ApiError('stream', data)
    }
    if (!isRecord(chunk) || !Array.isArray(chunk.choices)) {
      continue
    }
    const choice: unknown = chunk.choices.find(
      (item: unknown) => isRecord(item) && (item.index === undefined || item.index === 0)
    )
    if (!isRecord(choice)) {
      continue
    }
    if (!started) {
      started = true
      yield {
        type: 'message_start',
        message: { id: typeof chunk.id === 'string' ? chunk.id : '', model: provider.model },
      }
    }
    if (isRecord(choice.delta)) {
      const { content, reasoning_content: reasoning, refusal } = choice.delta
      refused ||= typeof refusal === 'string' && refusal.length > 0
      for (const [type, value] of [
        ['thinking', reasoning],
        ['text', content],
      ] as const) {
        if (typeof value !== 'string' || !value) {
          continue
        }
        if (current !== type) {
          if (current) {
            yield { type: 'content_block_stop', index }
          }
          current = type
          index += 1
          yield {
            type: 'content_block_start',
            index,
            content_block:
              type === 'text' ? { type, text: '' } : { type, thinking: '', signature: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index,
          delta:
            type === 'text'
              ? { type: 'text_delta', text: value }
              : { type: 'thinking_delta', thinking: value },
        }
      }
    }
    if (typeof choice.finish_reason === 'string') {
      reason = stopReason(choice.finish_reason)
    }
  }
  signal.throwIfAborted()
  if (!reason && !(sawDone && (current || refused))) {
    throw new ApiError('interrupted', '')
  }
  if (current) {
    yield { type: 'content_block_stop', index }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: refused ? 'refusal' : (reason ?? 'end_turn'), stop_sequence: null },
  }
  yield { type: 'message_stop' }
}
