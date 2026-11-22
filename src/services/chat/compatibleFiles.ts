import type { TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import type { OpenAIContentPart } from '../api/openai.js'
import {
  attachmentScope,
  getModelOptions,
  type CompatibleModel,
  type CompatibleProvider,
} from '../providers.js'
import type { FileAttachment } from './types.js'

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}
const VIDEO_TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }
const DOCUMENT_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'xml',
  'log',
  'yaml',
  'yml',
  'js',
  'ts',
  'py',
  'html',
  'css',
  'sql',
]
const MIME_TYPES: Record<string, string> = { ...IMAGE_TYPES, ...VIDEO_TYPES, ...DOCUMENT_TYPES }
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

export const COMPATIBLE_MAX_FILES = 8
export const COMPATIBLE_MAX_MB = 20
const MAX_BYTES = COMPATIBLE_MAX_MB * 1024 * 1024
const MAX_TEXT_KIB = 256

type AttachmentInfo = Pick<FileAttachment, 'name' | 'size' | 'mimeType'>
const mediaFormat = (file: AttachmentInfo) => {
  const ext = file.name.includes('.') ? extension(file.name) : ''
  const mime = MIME_TYPES[ext]
  if (mime?.startsWith('image/')) {
    return { kind: 'images', mime } as const
  }
  if (mime?.startsWith('video/')) {
    return { kind: 'videos', mime } as const
  }
  if (mime) {
    return { kind: 'files', mime } as const
  }
  if (TEXT_EXTENSIONS.includes(ext) || (!ext && file.mimeType.startsWith('text/'))) {
    return { kind: 'files', mime: 'text/plain' } as const
  }
  return null
}

export const compatibleAccept = (model: CompatibleModel) =>
  [
    ...(model.images ? Object.keys(IMAGE_TYPES) : []),
    ...(model.videos ? Object.keys(VIDEO_TYPES) : []),
    ...(model.files ? [...Object.keys(DOCUMENT_TYPES), ...TEXT_EXTENSIONS] : []),
  ]
    .map((ext) => `.${ext}`)
    .join(',')

export const validateCompatibleFiles = (
  files: AttachmentInfo[],
  model: CompatibleModel
): TranslationMessage | null => {
  if (files.length > COMPATIBLE_MAX_FILES) {
    return { key: 'uploadMaxFiles', params: { count: COMPATIBLE_MAX_FILES } }
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BYTES) {
    return { key: 'providerAttachmentBudget', params: { size: COMPATIBLE_MAX_MB } }
  }
  for (const file of files) {
    const format = mediaFormat(file)
    if (!format || file.size === 0) {
      return { key: 'uploadUnsupportedFormat' }
    }
    if (!model[format.kind]) {
      return { key: 'providerAttachmentsUnsupported', params: { name: file.name } }
    }
    if (format.mime === 'text/plain' && file.size > MAX_TEXT_KIB * 1024) {
      return { key: 'providerTextTooLarge', params: { name: file.name, size: MAX_TEXT_KIB } }
    }
  }
  return null
}

const readDataUrl = (bytes: Uint8Array, mime: string) => {
  const encoded: string[] = []
  // Multiples of three keep Base64 padding confined to the final chunk.
  const chunkSize = 3 * 8192
  for (let start = 0; start < bytes.length; start += chunkSize) {
    encoded.push(btoa(String.fromCharCode(...bytes.subarray(start, start + chunkSize))))
  }
  return `data:${mime};base64,${encoded.join('')}`
}

const encode = async (
  file: FileAttachment,
  blob: Blob,
  signal: AbortSignal
): Promise<OpenAIContentPart> => {
  signal.throwIfAborted()
  const format = mediaFormat(file)
  if (!format) {
    throw new ApiError('protocol', { key: 'uploadUnsupportedFormat' })
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  signal.throwIfAborted()
  if (format.mime === 'text/plain') {
    try {
      return {
        type: 'text',
        text: `${file.name}:\n${new TextDecoder('utf-8', { fatal: true }).decode(bytes)}`,
      }
    } catch {
      throw new ApiError('protocol', { key: 'providerTextEncoding', params: { name: file.name } })
    }
  }
  const url = readDataUrl(bytes, format.mime)
  if (format.kind === 'images') {
    return { type: 'image_url', image_url: { url } }
  }
  if (format.kind === 'videos') {
    return { type: 'video_url', video_url: { url } }
  }
  return { type: 'file', file: { filename: file.name, file_data: url } }
}

type LoadFile = (id: string) => Promise<Blob | undefined>

export const prepareCompatibleContent = async (
  provider: CompatibleProvider,
  history: { content: string; files: FileAttachment[] }[],
  question: { content: string; files: FileAttachment[] },
  loadFile: LoadFile,
  signal: AbortSignal
): Promise<{
  current: string | OpenAIContentPart[]
  history: (string | OpenAIContentPart[])[]
}> => {
  const model = getModelOptions(provider)
  const scope = attachmentScope(provider)
  const issue = validateCompatibleFiles(question.files, model)
  if (issue) {
    throw new ApiError('protocol', issue)
  }
  let bytesLeft = MAX_BYTES
  let filesLeft = COMPATIBLE_MAX_FILES
  const convert = async ({ content, files }: typeof question, strict: boolean) => {
    const parts: OpenAIContentPart[] = content ? [{ type: 'text', text: content }] : []
    let usedFiles = 0
    for (const file of files) {
      signal.throwIfAborted()
      if (file.compatibleScope !== scope) {
        if (strict) {
          throw new ApiError('protocol', {
            key: 'providerAttachmentScope',
            params: { name: file.name },
          })
        }
        continue
      }
      if (!filesLeft || file.size > bytesLeft || validateCompatibleFiles([file], model)) {
        continue
      }
      const blob = await loadFile(file.id)
      signal.throwIfAborted()
      if (!blob || blob.size !== file.size) {
        if (strict) {
          throw new ApiError('protocol', {
            key: 'providerAttachmentMissing',
            params: { name: file.name },
          })
        }
        continue
      }
      try {
        parts.push(await encode(file, blob, signal))
      } catch (error) {
        signal.throwIfAborted()
        if (strict) {
          throw error
        }
        continue
      }
      filesLeft--
      bytesLeft -= blob.size
      usedFiles++
    }
    return usedFiles ? parts : content
  }
  const current = await convert(question, true)
  const prior: (string | OpenAIContentPart[])[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    prior[i] = await convert(history[i], false)
  }
  return { current, history: prior }
}
