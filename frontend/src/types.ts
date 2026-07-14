// ===== 设置 =====

export type ApiMode = 'images' | 'responses'
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'
export const ZIP_DOWNLOAD_ROUTE_VALUES = [
  'task-selection',
  'favorite-collection-selection',
  'image-context-menu-all',
  'task-detail-all',
  'task-detail-partial',
] as const
export type ZipDownloadRoute = typeof ZIP_DOWNLOAD_ROUTE_VALUES[number]
export const DEFAULT_ZIP_DOWNLOAD_ROUTES: ZipDownloadRoute[] = ['task-selection', 'favorite-collection-selection']
export type BuiltInApiProvider = 'openai' | 'fal'
export type ApiProvider = BuiltInApiProvider | string
export const DEFAULT_STREAM_PARTIAL_IMAGES = 1

export interface AppSettings {
  /** 当前选择的平台模型 ID，平台化后替代旧 BYOK model 字段 */
  model: string
  clearInputAfterSubmit: boolean
  persistInputOnRestart: boolean
  alwaysShowRetryButton: boolean
  allowPromptRewrite: boolean
  taskCompletionNotification: boolean
  enterSubmit: boolean
  referenceImageEditAction: ReferenceImageEditAction
  zipDownloadRoutes: ZipDownloadRoute[]
}

const REFERENCE_IMAGE_EDIT_ACTIONS: ReferenceImageEditAction[] = ['ask', 'replace-reference', 'add-mask']

export const DEFAULT_SETTINGS: AppSettings = {
  model: '',
  clearInputAfterSubmit: false,
  persistInputOnRestart: true,
  alwaysShowRetryButton: false,
  allowPromptRewrite: true,
  taskCompletionNotification: false,
  enterSubmit: true,
  referenceImageEditAction: 'ask',
  zipDownloadRoutes: [...DEFAULT_ZIP_DOWNLOAD_ROUTES],
}

function normalizeZipDownloadRoutes(value: unknown): ZipDownloadRoute[] {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.zipDownloadRoutes]
  const allowed = new Set<string>(ZIP_DOWNLOAD_ROUTE_VALUES)
  const routes = value.filter((item): item is ZipDownloadRoute => typeof item === 'string' && allowed.has(item))
  return Array.from(new Set(routes))
}

/** 将任意（可能来自旧版持久化）的设置对象规整为合法的 AppSettings */
export function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const source = raw ?? {}
  return {
    model: typeof source.model === 'string' ? source.model : DEFAULT_SETTINGS.model,
    clearInputAfterSubmit: typeof source.clearInputAfterSubmit === 'boolean' ? source.clearInputAfterSubmit : DEFAULT_SETTINGS.clearInputAfterSubmit,
    persistInputOnRestart: typeof source.persistInputOnRestart === 'boolean' ? source.persistInputOnRestart : DEFAULT_SETTINGS.persistInputOnRestart,
    alwaysShowRetryButton: typeof source.alwaysShowRetryButton === 'boolean' ? source.alwaysShowRetryButton : DEFAULT_SETTINGS.alwaysShowRetryButton,
    allowPromptRewrite: typeof source.allowPromptRewrite === 'boolean' ? source.allowPromptRewrite : DEFAULT_SETTINGS.allowPromptRewrite,
    taskCompletionNotification: typeof source.taskCompletionNotification === 'boolean' ? source.taskCompletionNotification : DEFAULT_SETTINGS.taskCompletionNotification,
    enterSubmit: typeof source.enterSubmit === 'boolean' ? source.enterSubmit : DEFAULT_SETTINGS.enterSubmit,
    referenceImageEditAction: REFERENCE_IMAGE_EDIT_ACTIONS.includes(source.referenceImageEditAction as ReferenceImageEditAction)
      ? (source.referenceImageEditAction as ReferenceImageEditAction)
      : DEFAULT_SETTINGS.referenceImageEditAction,
    zipDownloadRoutes: normalizeZipDownloadRoutes(source.zipDownloadRoutes),
  }
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
  transparent_output: boolean
}

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
  transparent_output: false,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

export interface TaskRecord {
  id: string
  prompt: string
  params: TaskParams
  /** 生成时使用的平台模型 ID */
  apiModel?: string
  /** 平台模型展示名（快照） */
  platformModelName?: string
  /** 后端生成请求 ID，用于轮询状态 */
  generationRequestId?: string
  /** 建单时单价（单张，整数分） */
  unitPrice?: number
  /** 实际扣费额度（整数分） */
  chargedCredits?: number
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 是否启用透明背景后处理 */
  transparentOutput?: boolean
  /** 实际发送给 API 的透明背景辅助提示词 */
  transparentPrompt?: string
  /** 透明背景后处理前的原始输出图片 id，顺序对应 outputImages */
  transparentOriginalImages?: string[]
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 并发多图中失败的输出槽位，requestIndex 为从 0 开始的请求序号 */
  outputErrors?: Array<{ requestIndex: number; error: string }>
  /** 流式生成的中间步骤图片 id 列表，仅失败时保留供排查/下载 */
  streamPartialImageIds?: string[]
  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 所属收藏夹 ID 列表 */
  favoriteCollectionIds?: string[]
}

export interface FavoriteCollection {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
}

export interface StoredImageThumbnail {
  id: string
  /** 列表缩略图，用于避免卡片页解码完整 4K 原图 */
  thumbnailDataUrl: string
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 缩略图生成参数版本 */
  thumbnailVersion?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface FalImageFile {
  url?: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
  b64_json?: string
  base64?: string
  data?: string
}

export interface FalApiResponse {
  images?: FalImageFile[]
  image?: FalImageFile | string
  url?: string
  seed?: number
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  tasks?: TaskRecord[]
  favoriteCollections?: FavoriteCollection[]
  defaultFavoriteCollectionId?: string | null
  /** imageId → 图片信息 */
  imageFiles?: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated' | 'mask'
    width?: number
    height?: number
  }>
  /** imageId → 缩略图信息 */
  thumbnailFiles?: Record<string, {
    path: string
    width?: number
    height?: number
    thumbnailVersion?: number
  }>
}
