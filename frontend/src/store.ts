import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
  FavoriteCollection,
} from './types'
import { DEFAULT_PARAMS, normalizeSettings } from './types'
import { dismissAllTooltips } from './lib/tooltipDismiss'
import { remapImageMentionsForOrder, replaceImageMentionsForApi } from './lib/promptImageMentions'
import {
  CURRENT_THUMBNAIL_VERSION,
  getAllTasks,
  putTask as dbPutTask,
  deleteTask as dbDeleteTask,
  clearTasks as dbClearTasks,
  getImage,
  getImageThumbnail,
  getStoredFreshImageThumbnail,
  getAllImageIds,
  getAllImages,
  putImage,
  putImageThumbnail,
  deleteImage,
  clearImages,
  storeImage,
  storeImageWithSize,
} from './lib/db'
import { showBrowserNotification } from './lib/browserNotification'
import { validateMaskMatchesImage } from './lib/canvasImage'
import { orderInputImagesForMask } from './lib/mask'
import { getChangedParams, normalizeParamsForSettings } from './lib/paramCompatibility'
import { createTransparentOutputMeta, getTransparentRequestParams, removeKeyedBackgroundFromDataUrl } from './lib/transparentImage'
import { blobToDataUrl, fileToDataUrl } from './lib/dataUrl'
import { formatExportFileTime } from './lib/exportFileName'
import { buildExportZip, readExportZip, readExportZipFileAsDataUrl } from './lib/exportZip'

export const ALL_FAVORITES_COLLECTION_ID = '__all_favorites__'
export const DEFAULT_FAVORITE_COLLECTION_ID = '__default_favorites__'
export const DEFAULT_FAVORITE_COLLECTION_NAME = '默认'

// ===== Image cache =====
// 内存缓存，id → dataUrl。只保留少量最近使用图片，避免大量 4K data URL 常驻内存。

const imageCache = new Map<string, string>()
const thumbnailCache = new Map<string, { dataUrl: string; width?: number; height?: number; thumbnailVersion?: number }>()
const thumbnailBackfillIds = new Map<string, 'visible' | 'background'>()
const thumbnailBackfillRunningIds = new Set<string>()
const thumbnailSubscribers = new Map<string, Set<(thumbnail: { dataUrl: string; width?: number; height?: number }) => void>>()
let thumbnailBackfillScheduled = false
const MAX_IMAGE_CACHE_ENTRIES = 8
const MAX_THUMBNAIL_CACHE_ENTRIES = 80
const MAX_THUMBNAIL_BACKFILL_CONCURRENT = 4
const FAL_RECOVERY_POLL_MS = 10_000
const CUSTOM_RECOVERY_POLL_MS = 10_000
const falRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const customRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const openAIWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const OPENAI_INTERRUPTED_ERROR = '请求中断'
const ERROR_TOAST_MAX_LENGTH = 80
type ToastType = 'info' | 'success' | 'error'
type InputDraft = {
  prompt: string
  inputImages: InputImage[]
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  updatedAt?: number
}

export function getErrorToastMessage(message: string): string {
  const text = message.trim()
  if (!text) return '操作失败'

  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  const separatorIndex = firstLine.search(/[：:]/)
  if (separatorIndex > 0) {
    const title = firstLine.slice(0, separatorIndex).trim()
    if (isErrorToastTitle(title)) return title
  }

  if (firstLine.length > ERROR_TOAST_MAX_LENGTH) return '操作失败，请查看详情'
  return firstLine || '操作失败'
}

function getToastMessage(message: string, type: ToastType): string {
  return type === 'error' ? getErrorToastMessage(message) : message
}

function isErrorToastTitle(title: string): boolean {
  return /(?:失败|错误|异常|报错|无法|不能|超时|中断|断开|请先|请输入|已达上限|不存在|已丢失)$/.test(title)
}

export type SettingsTab = 'general' | 'data' | 'about'

type TimeoutStreamingHintProfile = {
  provider?: string
  streamImages?: boolean
  streamPartialImages?: number
}

const TIMEOUT_STREAMING_HINT = '也可尝试打开「流式传输」，并提高「请求中间步骤图像数」来维持连接。'
const TIMEOUT_PARTIAL_IMAGES_ZERO_HINT = '官方流式接口不发送心跳，当前「请求中间步骤图像数」为 0，连接可能因无数据传输而断开。建议提高到 2 或 3。'
const TIMEOUT_PARTIAL_IMAGES_LOW_HINT = '也可尝试提高「请求中间步骤图像数」来维持连接，避免长时间无数据传输导致断开。'

function getTimeoutStreamingHint(profile?: TimeoutStreamingHintProfile | null) {
  if (profile?.provider !== 'openai') return ''
  const partialImages = profile.streamPartialImages ?? 0
  if (profile.streamImages !== true) return TIMEOUT_STREAMING_HINT
  if (partialImages === 0) return TIMEOUT_PARTIAL_IMAGES_ZERO_HINT
  return partialImages < 3 ? TIMEOUT_PARTIAL_IMAGES_LOW_HINT : ''
}

function createOpenAITimeoutError(timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  return `请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。${getTimeoutStreamingHint(profile)}`
}

export function getCachedImage(id: string): string | undefined {
  const dataUrl = imageCache.get(id)
  if (dataUrl) {
    imageCache.delete(id)
    imageCache.set(id, dataUrl)
  }
  return dataUrl
}

function cacheImage(id: string, dataUrl: string) {
  imageCache.delete(id)
  imageCache.set(id, dataUrl)
  while (imageCache.size > MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = imageCache.keys().next().value
    if (oldestKey == null) break
    imageCache.delete(oldestKey)
  }
}

function getCachedThumbnail(id: string) {
  const thumbnail = thumbnailCache.get(id)
  if (thumbnail?.thumbnailVersion === CURRENT_THUMBNAIL_VERSION) {
    thumbnailCache.delete(id)
    thumbnailCache.set(id, thumbnail)
    return thumbnail
  }
  if (thumbnail) {
    thumbnailCache.delete(id)
  }
  return undefined
}

function cacheThumbnail(id: string, thumbnail: { dataUrl: string; width?: number; height?: number; thumbnailVersion?: number }) {
  if (thumbnail.thumbnailVersion !== CURRENT_THUMBNAIL_VERSION) return
  thumbnailCache.delete(id)
  thumbnailCache.set(id, thumbnail)
  while (thumbnailCache.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
    const oldestKey = thumbnailCache.keys().next().value
    if (oldestKey == null) break
    thumbnailCache.delete(oldestKey)
  }
}

export async function ensureImageCached(id: string): Promise<string | undefined> {
  const cached = getCachedImage(id)
  if (cached) return cached
  const rec = await getImage(id)
  if (rec) {
    cacheImage(id, rec.dataUrl)
    return rec.dataUrl
  }
  return undefined
}

export async function ensureImageThumbnailCached(id: string): Promise<{ dataUrl: string; width?: number; height?: number } | undefined> {
  const cached = getCachedThumbnail(id)
  if (cached) return cached

  const rec = await getStoredFreshImageThumbnail(id)
  if (!rec?.thumbnailDataUrl) {
    scheduleThumbnailBackfill([id], 'visible')
    return undefined
  }

  const thumbnail = {
    dataUrl: rec.thumbnailDataUrl,
    width: rec.width,
    height: rec.height,
    thumbnailVersion: rec.thumbnailVersion,
  }
  cacheThumbnail(id, thumbnail)
  return thumbnail
}

export function subscribeImageThumbnail(id: string, callback: (thumbnail: { dataUrl: string; width?: number; height?: number }) => void) {
  let subscribers = thumbnailSubscribers.get(id)
  if (!subscribers) {
    subscribers = new Set()
    thumbnailSubscribers.set(id, subscribers)
  }
  subscribers.add(callback)
  return () => {
    subscribers?.delete(callback)
    if (subscribers?.size === 0) thumbnailSubscribers.delete(id)
  }
}

function notifyImageThumbnail(id: string, thumbnail: { dataUrl: string; width?: number; height?: number }) {
  thumbnailSubscribers.get(id)?.forEach((callback) => callback(thumbnail))
}

function scheduleThumbnailBackfill(ids: Iterable<string>, priority: 'visible' | 'background' = 'background') {
  for (const id of ids) {
    if (getCachedThumbnail(id) || thumbnailBackfillRunningIds.has(id)) continue
    const currentPriority = thumbnailBackfillIds.get(id)
    if (!currentPriority || priority === 'visible') thumbnailBackfillIds.set(id, priority)
  }
  scheduleThumbnailBackfillTick()
}

function scheduleThumbnailBackfillTick() {
  if (thumbnailBackfillScheduled || thumbnailBackfillIds.size === 0) return
  thumbnailBackfillScheduled = true

  const run = () => {
    thumbnailBackfillScheduled = false
    void processNextThumbnailBackfill()
  }

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2_000 })
  } else {
    globalThis.setTimeout(run, 250)
  }
}

async function processNextThumbnailBackfill() {
  if (thumbnailBackfillRunningIds.size > 0) return

  const ids = await getNextThumbnailBackfillBatch()
  for (const id of ids) startThumbnailBackfill(id)

  if (thumbnailBackfillIds.size > 0) scheduleThumbnailBackfillTick()
}

async function getNextThumbnailBackfillBatch() {
  const candidates = getOrderedThumbnailBackfillIds().slice(0, MAX_THUMBNAIL_BACKFILL_CONCURRENT)
  if (candidates.length === 0) return []

  const sizes = await Promise.all(candidates.map(async (id) => {
    const image = await getImage(id)
    return { width: image?.width, height: image?.height }
  }))
  const concurrency = getThumbnailConcurrencyForBatch(sizes)
  const selected = candidates.slice(0, concurrency)
  for (const id of selected) thumbnailBackfillIds.delete(id)
  return selected
}

function getOrderedThumbnailBackfillIds() {
  const visible: string[] = []
  const background: string[] = []
  for (const [id, priority] of thumbnailBackfillIds) {
    if (priority === 'visible') visible.push(id)
    else background.push(id)
  }
  return [...visible, ...background]
}

function getThumbnailConcurrencyForBatch(sizes: Array<{ width?: number; height?: number }>) {
  let maxMegapixels = 0
  for (const { width, height } of sizes) {
    if (!width || !height) return 1
    maxMegapixels = Math.max(maxMegapixels, (width * height) / 1_000_000)
  }
  const megapixels = maxMegapixels
  if (megapixels >= 8) return 1
  if (megapixels >= 4) return 2
  if (megapixels >= 2) return 3
  return 4
}

function startThumbnailBackfill(id: string) {
  thumbnailBackfillRunningIds.add(id)

  void (async () => {
    if (getCachedThumbnail(id)) return

    const thumbnail = await getImageThumbnail(id)
    if (thumbnail?.thumbnailDataUrl) {
      cacheThumbnail(id, {
        dataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: thumbnail.thumbnailVersion,
      })
      notifyImageThumbnail(id, {
        dataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
      })
    }
  })().catch(() => {
    // Keep thumbnail generation best-effort; cards remain on placeholders if it fails.
  }).finally(() => {
    thumbnailBackfillRunningIds.delete(id)
    scheduleThumbnailBackfillTick()
  })
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

function showTaskCompletionNotification(title: string, body: string) {
  const settings = normalizeSettings(useStore.getState().settings)
  if (!settings.taskCompletionNotification) return
  showBrowserNotification(title, { body })
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function migratePersistedState(persistedState: unknown): unknown {
  return persistedState
}

function normalizeFavoriteCollectionName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function createDefaultFavoriteCollection(now = Date.now()): FavoriteCollection {
  return {
    id: DEFAULT_FAVORITE_COLLECTION_ID,
    name: DEFAULT_FAVORITE_COLLECTION_NAME,
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeFavoriteCollections(value: unknown): FavoriteCollection[] {
  const now = Date.now()
  const collections = Array.isArray(value) ? value : []
  const normalized: FavoriteCollection[] = []
  const ids = new Set<string>()
  for (const item of collections) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    const id = item.id
    if (id === ALL_FAVORITES_COLLECTION_ID || ids.has(id)) continue
    const name = normalizeFavoriteCollectionName(typeof item.name === 'string' ? item.name : '')
    if (!name) continue
    ids.add(id)
    normalized.push({
      id,
      name: name.slice(0, 60),
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
    })
  }
  return normalized
}

function ensureDefaultFavoriteCollection(collections: FavoriteCollection[]) {
  if (collections.length > 0) return collections
  return [createDefaultFavoriteCollection(), ...collections]
}

/** 确保"默认"收藏夹存在（用于兜底孤立收藏任务） */
function ensureDefaultNamedCollection(collections: FavoriteCollection[]) {
  if (getDefaultNamedFavoriteCollectionId(collections)) return collections
  return [createDefaultFavoriteCollection(), ...collections]
}

function getDefaultNamedFavoriteCollectionId(collections: FavoriteCollection[]) {
  return collections.find((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID)?.id
    ?? collections.find((collection) => collection.name === DEFAULT_FAVORITE_COLLECTION_NAME)?.id
    ?? null
}

function resolveDefaultFavoriteCollectionId(collections: FavoriteCollection[], preferredId: unknown) {
  if (preferredId === null) return null
  if (typeof preferredId === 'string' && collections.some((collection) => collection.id === preferredId)) return preferredId
  if (collections.some((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID)) return DEFAULT_FAVORITE_COLLECTION_ID
  return collections[0]?.id ?? null
}


export function getPersistedState(state: AppState) {
  const settings = normalizeSettings(state.settings)
  const galleryInputDraft = getPersistableGalleryInputDraft(state)
  return {
    settings,
    params: state.params,
    ...(settings.persistInputOnRestart && galleryInputDraft
      ? {
          prompt: galleryInputDraft?.prompt ?? '',
          inputImages: galleryInputDraft?.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) ?? [],
        }
      : {}),
    dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
    appMode: 'gallery',
    galleryInputDraft: settings.persistInputOnRestart && galleryInputDraft
      ? { ...galleryInputDraft, inputImages: galleryInputDraft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) }
      : null,
    favoriteCollections: state.favoriteCollections,
    defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
  }
}

function mergePersistedState(persistedState: unknown, currentState: AppState): AppState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const persisted = persistedState as Partial<AppState>
  const settings = normalizeSettings(persisted.settings ?? currentState.settings)
  const galleryInputDraft = settings.persistInputOnRestart
    ? normalizeInputDraft(persisted.galleryInputDraft ?? {
        prompt: persisted.prompt,
        inputImages: persisted.inputImages,
        maskDraft: null,
        maskEditorImageId: null,
      })
    : null
  const favoriteCollections = Array.isArray(persisted.favoriteCollections)
    ? ensureDefaultFavoriteCollection(normalizeFavoriteCollections(persisted.favoriteCollections))
    : currentState.favoriteCollections
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(favoriteCollections, persisted.defaultFavoriteCollectionId)
  return {
    ...currentState,
    ...persisted,
    settings,
    appMode: 'gallery',
    galleryInputDraft: galleryInputDraft && !isEmptyInputDraft(galleryInputDraft) ? galleryInputDraft : null,
    favoriteCollections,
    defaultFavoriteCollectionId,
    activeFavoriteCollectionId: null,
    favoritePickerTaskIds: null,
    prompt: galleryInputDraft?.prompt ?? '',
    inputImages: galleryInputDraft?.inputImages ?? [],
    maskDraft: galleryInputDraft?.maskDraft ?? null,
    maskEditorImageId: galleryInputDraft?.maskEditorImageId ?? null,
  }
}

// ===== Store 类型 =====

interface AppState {
  // 模式
  appMode: 'gallery'
  setAppMode: (mode: 'gallery') => void

  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  replaceInputImage: (idx: number, img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[], options?: { equivalentImageIds?: Record<string, string> }) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void
  galleryInputDraft: InputDraft | null

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void
  favoriteCollections: FavoriteCollection[]
  setFavoriteCollections: (collections: FavoriteCollection[]) => void
  defaultFavoriteCollectionId: string | null
  setDefaultFavoriteCollectionId: (id: string | null) => void
  activeFavoriteCollectionId: string | null
  isManageCollectionsModalOpen: boolean
  setActiveFavoriteCollectionId: (id: string | null) => void
  openManageCollectionsModal: () => void
  closeManageCollectionsModal: () => void
  favoritePickerTaskIds: string[] | null
  openFavoritePicker: (taskIds: string[]) => void
  closeFavoritePicker: () => void
  streamPreviews: Record<string, string>
  streamPreviewSlots: Record<string, Record<string, string>>
  setTaskStreamPreview: (taskId: string, image?: string, requestIndex?: number) => void

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void
  selectedFavoriteCollectionIds: string[]
  setSelectedFavoriteCollectionIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleFavoriteCollectionSelection: (id: string, force?: boolean) => void
  clearFavoriteCollectionSelection: () => void

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  settingsTabRequest: SettingsTab | null
  setShowSettings: (v: boolean, tab?: SettingsTab) => void
  // Toast
  toast: { message: string; type: ToastType } | null
  showToast: (message: string, type?: ToastType) => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    checkbox?: {
      label: string
      defaultChecked?: boolean
      disabled?: boolean
      tone?: 'primary' | 'danger'
    }
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    buttons?: Array<{
      label: string
      tone?: 'primary' | 'secondary' | 'danger' | 'warning'
      action: (checkboxChecked?: boolean) => void
    }>
    icon?: 'info' | 'copy'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action?: (checkboxChecked?: boolean) => void
    cancelAction?: (checkboxChecked?: boolean) => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

function isImageReferencedByState(state: AppState, imageId: string) {
  if (state.inputImages.some((img) => img.id === imageId)) return true
  if (state.galleryInputDraft?.inputImages.some((img) => img.id === imageId)) return true
  if (state.tasks.some((task) =>
    task.inputImageIds.includes(imageId) ||
    task.outputImages.includes(imageId) ||
    task.transparentOriginalImages?.includes(imageId) ||
    task.streamPartialImageIds?.includes(imageId) ||
    task.maskTargetImageId === imageId ||
    task.maskImageId === imageId
  )) return true
  return false
}

export async function deleteImageIfUnreferenced(imageId: string) {
  imageCache.delete(imageId)
  thumbnailCache.delete(imageId)
  thumbnailBackfillIds.delete(imageId)
  thumbnailBackfillRunningIds.delete(imageId)
  thumbnailSubscribers.delete(imageId)
  if (isImageReferencedByState(useStore.getState(), imageId)) return
  try {
    await deleteImage(imageId)
  } catch {
    // 清理是内存/存储优化，失败不影响替换结果。
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeInputImages(value: unknown): InputImage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((img): InputImage | null => {
      if (!isRecord(img) || typeof img.id !== 'string') return null
      return { id: img.id, dataUrl: typeof img.dataUrl === 'string' ? img.dataUrl : '' }
    })
    .filter((img): img is InputImage => img != null)
}

function normalizeMaskDraft(value: unknown): MaskDraft | null {
  if (!isRecord(value)) return null
  if (typeof value.targetImageId !== 'string' || typeof value.maskDataUrl !== 'string') return null
  return {
    targetImageId: value.targetImageId,
    maskDataUrl: value.maskDataUrl,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

function normalizeInputDraft(value: unknown, fallbackUpdatedAt = Date.now()): InputDraft {
  const draft = isRecord(value) ? value : {}
  const updatedAt = typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : fallbackUpdatedAt
  return {
    prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    inputImages: normalizeInputImages(draft.inputImages),
    maskDraft: normalizeMaskDraft(draft.maskDraft),
    maskEditorImageId: typeof draft.maskEditorImageId === 'string' ? draft.maskEditorImageId : null,
    updatedAt,
  }
}

function clearInputDraftState(): Pick<InputDraft, 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'> {
  return {
    prompt: '',
    inputImages: [],
    maskDraft: null,
    maskEditorImageId: null,
  }
}

function copyInputDraft(draft: InputDraft): InputDraft {
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
    updatedAt: draft.updatedAt ?? Date.now(),
  }
}

function getCurrentInputDraft(state: Pick<AppState, 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'>): InputDraft {
  return {
    prompt: state.prompt,
    inputImages: state.inputImages,
    maskDraft: state.maskDraft,
    maskEditorImageId: state.maskEditorImageId,
    updatedAt: Date.now(),
  }
}

function isEmptyInputDraft(draft: InputDraft) {
  return draft.prompt.length === 0 && draft.inputImages.length === 0 && !draft.maskDraft && !draft.maskEditorImageId
}

function saveGalleryInputDraft(state: Pick<AppState, 'appMode' | 'galleryInputDraft' | 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'>) {
  if (state.appMode !== 'gallery') return state.galleryInputDraft
  const draft = getCurrentInputDraft(state)
  return isEmptyInputDraft(draft) ? null : copyInputDraft(draft)
}

function getPersistableGalleryInputDraft(state: AppState) {
  return saveGalleryInputDraft(state)
}

function restoreGalleryInputDraftState(draft: InputDraft | null): Pick<InputDraft, 'prompt' | 'inputImages' | 'maskDraft' | 'maskEditorImageId'> {
  if (!draft) return clearInputDraftState()
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
  }
}

function syncActiveInputDraft<T extends Partial<InputDraft>>(
  state: AppState,
  patch: T,
): T & { galleryInputDraft?: InputDraft | null } {
  const draft: InputDraft = {
    prompt: patch.prompt ?? state.prompt,
    inputImages: patch.inputImages ?? state.inputImages,
    maskDraft: patch.maskDraft !== undefined ? patch.maskDraft : state.maskDraft,
    maskEditorImageId: patch.maskEditorImageId !== undefined ? patch.maskEditorImageId : state.maskEditorImageId,
  }
  return {
    ...patch,
    galleryInputDraft: isEmptyInputDraft(draft) ? null : copyInputDraft(draft),
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Mode
      appMode: 'gallery',
      setAppMode: (_appMode) => {
        const state = get()
        const galleryInputDraft = saveGalleryInputDraft(state)
        set({ appMode: 'gallery', galleryInputDraft, selectedTaskIds: [], selectedFavoriteCollectionIds: [] })
      },

      // Settings
      settings: {} as AppSettings,
      setSettings: (s) => set((st) => {
        const settings = normalizeSettings({ ...st.settings, ...s })
        return { settings }
      }),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
          ? st.dismissedCodexCliPrompts
          : [...st.dismissedCodexCliPrompts, key],
      })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set((s) => syncActiveInputDraft(s, { prompt })),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return syncActiveInputDraft(s, { inputImages: [...s.inputImages, img] })
        }),
      replaceInputImage: (idx, img) => {
        let removedImageId: string | null = null
        set((s) => {
          if (idx < 0 || idx >= s.inputImages.length) return s
          const previous = s.inputImages[idx]
          if (!previous || previous.id === img.id) return s
          if (s.inputImages.some((item, itemIdx) => itemIdx !== idx && item.id === img.id)) return s
          removedImageId = previous.id
          const inputImages = s.inputImages.map((item, itemIdx) => itemIdx === idx ? img : item)
          const shouldClearMask = previous.id === s.maskDraft?.targetImageId
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, { [previous.id]: img.id }),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        })
        if (removedImageId) void deleteImageIfUnreferenced(removedImageId)
      },
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const inputImages = s.inputImages.filter((_, i) => i !== idx)
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) imageCache.delete(img.id)
          return syncActiveInputDraft(s, {
            inputImages: [],
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, []),
            maskDraft: null,
            maskEditorImageId: null,
          })
        }),
      setInputImages: (imgs, options) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, options?.equivalentImageIds),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return syncActiveInputDraft(s, {
            inputImages: images,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, images),
          })
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            maskDraft,
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
          })
        }),
      clearMaskDraft: () => set((s) => syncActiveInputDraft(s, { maskDraft: null })),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => {
        if (maskEditorImageId) dismissAllTooltips()
        set((s) => syncActiveInputDraft(s, { maskEditorImageId }))
      },
      galleryInputDraft: null,

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set({ tasks }),
      favoriteCollections: [createDefaultFavoriteCollection()],
      setFavoriteCollections: (favoriteCollections) => set((state) => {
        const nextCollections = ensureDefaultFavoriteCollection(normalizeFavoriteCollections(favoriteCollections))
        return {
          favoriteCollections: nextCollections,
          defaultFavoriteCollectionId: resolveDefaultFavoriteCollectionId(nextCollections, state.defaultFavoriteCollectionId),
        }
      }),
      defaultFavoriteCollectionId: DEFAULT_FAVORITE_COLLECTION_ID,
      setDefaultFavoriteCollectionId: (defaultFavoriteCollectionId) => set((state) => (
        defaultFavoriteCollectionId === null || state.favoriteCollections.some((collection) => collection.id === defaultFavoriteCollectionId)
          ? { defaultFavoriteCollectionId }
          : state
      )),
      activeFavoriteCollectionId: null,
      isManageCollectionsModalOpen: false,
      setActiveFavoriteCollectionId: (activeFavoriteCollectionId) => set({ activeFavoriteCollectionId, selectedTaskIds: [], selectedFavoriteCollectionIds: [] }),
      openManageCollectionsModal: () => set({ isManageCollectionsModalOpen: true }),
      closeManageCollectionsModal: () => set({ isManageCollectionsModalOpen: false }),
      favoritePickerTaskIds: null,
      openFavoritePicker: (taskIds) => {
        if (!taskIds.length) return
        dismissAllTooltips()
        set({ favoritePickerTaskIds: Array.from(new Set(taskIds)).filter(Boolean) })
      },
      closeFavoritePicker: () => set({ favoritePickerTaskIds: null }),
      streamPreviews: {},
      streamPreviewSlots: {},
      setTaskStreamPreview: (taskId, image, requestIndex = 0) => set((s) => {
        if (image) {
          const slotKey = String(requestIndex)
          const currentSlots = s.streamPreviewSlots[taskId] ?? {}
          if (s.streamPreviews[taskId] === image && currentSlots[slotKey] === image) return s
          return {
            streamPreviews: { ...s.streamPreviews, [taskId]: image },
            streamPreviewSlots: {
              ...s.streamPreviewSlots,
              [taskId]: { ...currentSlots, [slotKey]: image },
            },
          }
        }

        if (!(taskId in s.streamPreviews) && !(taskId in s.streamPreviewSlots)) return s
        const next = { ...s.streamPreviews }
        const nextSlots = { ...s.streamPreviewSlots }
        delete next[taskId]
        delete nextSlots[taskId]
        return { streamPreviews: next, streamPreviewSlots: nextSlots }
      }),

      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set(filterFavorite ? { filterFavorite, selectedTaskIds: [], selectedFavoriteCollectionIds: [] } : { filterFavorite, activeFavoriteCollectionId: null, selectedTaskIds: [], selectedFavoriteCollectionIds: [] }),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) => set((s) => ({
        selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater
      })),
      toggleTaskSelection: (id, force) => set((s) => {
        const isSelected = s.selectedTaskIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedTaskIds: shouldSelect
            ? [...s.selectedTaskIds, id]
            : s.selectedTaskIds.filter((x) => x !== id)
        }
      }),
      clearSelection: () => set({ selectedTaskIds: [] }),
      selectedFavoriteCollectionIds: [],
      setSelectedFavoriteCollectionIds: (updater) => set((s) => ({
        selectedFavoriteCollectionIds: typeof updater === 'function' ? updater(s.selectedFavoriteCollectionIds) : updater
      })),
      toggleFavoriteCollectionSelection: (id, force) => set((s) => {
        const isSelected = s.selectedFavoriteCollectionIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedFavoriteCollectionIds: shouldSelect
            ? [...s.selectedFavoriteCollectionIds, id]
            : s.selectedFavoriteCollectionIds.filter((x) => x !== id)
        }
      }),
      clearFavoriteCollectionSelection: () => set({ selectedFavoriteCollectionIds: [] }),

      // UI
      detailTaskId: null,
      setDetailTaskId: (detailTaskId) => {
        if (detailTaskId) dismissAllTooltips()
        set({ detailTaskId })
      },
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) => {
        if (lightboxImageId) dismissAllTooltips()
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) })
      },
      showSettings: false,
      settingsTabRequest: null,
      setShowSettings: (showSettings, settingsTabRequest) => {
        if (showSettings) dismissAllTooltips()
        set({
          showSettings,
          ...(settingsTabRequest ? { settingsTabRequest } : {}),
          ...(!showSettings ? { settingsTabRequest: null } : {}),
        })
      },
      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        const toastMessage = getToastMessage(message, type)
        const toast = { message: toastMessage, type }
        set({ toast })
        setTimeout(() => {
          set((s) => (s.toast === toast ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => {
        if (confirmDialog) dismissAllTooltips()
        set({ confirmDialog })
      },
    }),
    {
      name: 'gpt-image-playground',
      version: 2,
      migrate: (persistedState) => migratePersistedState(persistedState),
      partialize: getPersistedState,
      merge: mergePersistedState,
    },
  ),
)

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbPutTask(task)
}

function isOpenAITask(task: TaskRecord) {
  return (task.apiProvider ?? 'openai') !== 'fal'
}

function isRunningOpenAITask(task: TaskRecord) {
  return task.status === 'running' && isOpenAITask(task)
}

export function markInterruptedOpenAIRunningTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    if (!isRunningOpenAITask(task) || task.customTaskId) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: OPENAI_INTERRUPTED_ERROR,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

function clearOpenAIWatchdogTimer(taskId: string) {
  const timer = openAIWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  openAIWatchdogTimers.delete(taskId)
}

function failOpenAITaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return false

  updateTaskInStore(taskId, {
    status: 'error',
    error,
    falRecoverable: false,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

function scheduleOpenAIWatchdog(taskId: string, timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  clearOpenAIWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return

  const timeoutMs = Math.max(0, timeoutSeconds * 1000)
  const remainingMs = Math.max(0, timeoutMs - (Date.now() - task.createdAt))
  const timer = setTimeout(() => {
    openAIWatchdogTimers.delete(taskId)
    const failed = failOpenAITaskIfStillRunning(taskId, createOpenAITimeoutError(timeoutSeconds, profile))
    if (failed) useStore.getState().showToast('OpenAI 任务请求超时', 'error')
  }, remainingMs)
  openAIWatchdogTimers.set(taskId, timer)
}

export function taskHasOutputErrors(task: Pick<TaskRecord, 'outputErrors'>) {
  return Boolean(task.outputErrors?.length)
}

export function taskMatchesFilterStatus(task: TaskRecord, filterStatus: AppState['filterStatus']) {
  if (filterStatus === 'all') return true
  if (filterStatus === 'error') return task.status === 'error' || taskHasOutputErrors(task)
  return task.status === filterStatus
}

export function taskMatchesSearchQuery(task: TaskRecord, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const prompt = (task.prompt || '').toLowerCase()
  const paramStr = JSON.stringify(task.params).toLowerCase()
  const errorStr = [task.error, ...(task.outputErrors ?? []).map((item) => item.error)].filter(Boolean).join('\n').toLowerCase()
  return prompt.includes(q) || paramStr.includes(q) || errorStr.includes(q)
}

function isNetworkRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function isApiRequestNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase()
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message)
  }
  return false
}

function getApiRequestNetworkErrorHint(
  err: unknown,
  createdAt: number,
  usesApiProxy: boolean,
  profile?: TimeoutStreamingHintProfile | null,
): string | null {
  if (!isApiRequestNetworkError(err)) return null

  const elapsedSeconds = Math.max(0, (Date.now() - createdAt) / 1000)

  if (elapsedSeconds <= 15) {
    if (usesApiProxy) {
      return '提示：请求立即失败，请检查 API 代理服务是否正常运行。'
    }
    return `提示：请求立即失败，可能原因：\n· API 服务器不可达或地址有误，请检查 API URL 是否正确、服务是否正常运行\n· 接口不支持浏览器跨域请求，可使用 Docker 部署版或本地运行版并配置 API 代理解决`
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return `提示：请求等待约 60 秒后被断开，这通常是 Nginx 等反向代理的默认超时，而非接口本身报错。可调大代理的超时时间（如 proxy_read_timeout），或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return `提示：请求等待约 120 秒后被断开，这通常是 Cloudflare 等 CDN/网关的超时限制，而非接口本身报错。如果使用 Cloudflare，可考虑升级套餐或使用不经过 CDN 的直连地址。${getTimeoutStreamingHint(profile)}`
  }

  return `提示：请求等待较长时间后被断开，通常是反向代理或网关的超时限制，而非接口本身报错。可检查代理超时设置，或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`
}

function getRawErrorPayload(err: unknown): Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'> {
  if (!(err instanceof Error)) return {}

  const rawImageUrls = 'rawImageUrls' in err ? (err as { rawImageUrls?: unknown }).rawImageUrls : undefined
  const rawResponsePayload = 'rawResponsePayload' in err ? (err as { rawResponsePayload?: unknown }).rawResponsePayload : undefined
  return {
    rawImageUrls: Array.isArray(rawImageUrls) && rawImageUrls.length ? rawImageUrls.filter((url): url is string => typeof url === 'string') : undefined,
    rawResponsePayload: typeof rawResponsePayload === 'string' ? rawResponsePayload : undefined,
  }
}

function clearFalRecoveryTimer(taskId: string) {
  const timer = falRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  falRecoveryTimers.delete(taskId)
}

function scheduleFalRecovery(taskId: string, delayMs = FAL_RECOVERY_POLL_MS) {
  if (falRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    falRecoveryTimers.delete(taskId)
    recoverFalTask(taskId)
  }, delayMs)
  falRecoveryTimers.set(taskId, timer)
}

function clearCustomRecoveryTimer(taskId: string) {
  const timer = customRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  customRecoveryTimers.delete(taskId)
}

function scheduleCustomRecovery(taskId: string, delayMs = CUSTOM_RECOVERY_POLL_MS) {
  if (customRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    customRecoveryTimers.delete(taskId)
    recoverCustomTask(taskId)
  }, delayMs)
  customRecoveryTimers.set(taskId, timer)
}

function hasActualParams(params: Partial<TaskParams> | undefined): params is Partial<TaskParams> {
  return Boolean(params && Object.keys(params).length > 0)
}

function firstActualParams(paramsList: Array<Partial<TaskParams> | undefined> | undefined): Partial<TaskParams> | undefined {
  return paramsList?.find(hasActualParams)
}

function mapActualParamsByImage(outputIds: string[], paramsList: Array<Partial<TaskParams> | undefined> | undefined) {
  const mapped = paramsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
    const imgId = outputIds[index]
    if (imgId && hasActualParams(params)) acc[imgId] = params
    return acc
  }, {})
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined
}

function getImageSizeParam(size: { width?: number; height?: number } | undefined): Partial<TaskParams> | undefined {
  if (!size?.width || !size.height) return undefined
  return { size: `${size.width}x${size.height}` }
}

function hasActualSizeParam(params: Partial<TaskParams> | undefined) {
  return Boolean(params?.size)
}

function addImageSizeParam(
  params: Partial<TaskParams> | undefined,
  size: { width?: number; height?: number } | undefined,
): Partial<TaskParams> | undefined {
  if (hasActualSizeParam(params)) return params
  const sizeParam = getImageSizeParam(size)
  if (!sizeParam) return params
  return { ...(params ?? {}), ...sizeParam }
}

async function readImageSizeParam(dataUrl: string): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === 'undefined') return undefined

  return new Promise((resolve) => {
    let settled = false
    const image = new Image()
    const finish = (params: Partial<TaskParams> | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    }
    const timer = setTimeout(() => finish(undefined), 2000)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
      } else {
        finish(undefined)
      }
    }
    image.onerror = () => finish(undefined)
    image.src = dataUrl
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
    }
  })
}

async function readImageSizeParamsList(images: string[]): Promise<Array<Partial<TaskParams> | undefined>> {
  return Promise.all(images.map((image) => readImageSizeParam(image)))
}

async function resolveImageSizeParamsList(
  images: string[],
  preferred?: Array<Partial<TaskParams> | undefined>,
  sizes?: Array<{ width?: number; height?: number } | undefined>,
): Promise<Array<Partial<TaskParams> | undefined>> {
  const withStoredSizes = images.map((_, index) => addImageSizeParam(preferred?.[index], sizes?.[index]))
  if (withStoredSizes.every(hasActualSizeParam)) {
    return withStoredSizes
  }
  const fallback = await readImageSizeParamsList(images)
  return images.map((_, index) => {
    const params = withStoredSizes[index]
    const fallbackParams = fallback[index]
    if (hasActualSizeParam(params)) return params
    if (fallbackParams?.size) return { ...(params ?? {}), size: fallbackParams.size }
    return hasActualParams(params) ? params : fallbackParams
  })
}

async function completeRecoveredFalTask(task: TaskRecord, result: Awaited<ReturnType<typeof getFalQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return
  if (latest.status !== 'running' && !latest.falRecoverable) return

  const { outputIds, outputDataUrls, outputImageSizes, transparentOriginalImageIds } = await storeTaskOutputImages(task, result.images)
  const actualParamsList = await resolveImageSizeParamsList(outputDataUrls, result.actualParamsList, outputImageSizes)
  const latestBeforeUpdate = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latestBeforeUpdate || latestBeforeUpdate.status === 'done' || (latestBeforeUpdate.status !== 'running' && !latestBeforeUpdate.falRecoverable)) {
    await deleteUnreferencedImageIds([...outputIds, ...(transparentOriginalImageIds ?? [])])
    return
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    transparentOriginalImages: transparentOriginalImageIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    status: 'done',
    error: null,
    falRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
  })
  useStore.getState().showToast(`fal.ai 任务已恢复，共 ${outputIds.length} 张图片`, 'success')
  showTaskCompletionNotification('图像生成完成', `fal.ai 任务已恢复，共 ${outputIds.length} 张图片。`)
}

async function recoverFalTask(taskId: string) {
  const { tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || task.apiProvider !== 'fal' || !task.falRequestId || !task.falEndpoint || task.status === 'done') return

  scheduleFalRecovery(taskId)
}

/** 初始化：从 IndexedDB 加载任务，按需恢复输入图片，并清理孤立图片 */
export async function initStore() {
  const storedTasks = await getAllTasks()
  const { tasks: markedTasks, interruptedTasks } = markInterruptedOpenAIRunningTasks(storedTasks)
  const interruptedTaskIds = new Set(interruptedTasks.map((task) => task.id))
  const favoriteState = useStore.getState()
  const normalizedFavorites = normalizeLoadedFavoriteState(markedTasks.map(getPersistableTask), favoriteState.favoriteCollections, favoriteState.defaultFavoriteCollectionId)
  const tasks = normalizedFavorites.tasks
  if (normalizedFavorites.collections !== favoriteState.favoriteCollections) {
    favoriteState.setFavoriteCollections(normalizedFavorites.collections)
  }
  if (normalizedFavorites.defaultFavoriteCollectionId !== favoriteState.defaultFavoriteCollectionId) {
    useStore.getState().setDefaultFavoriteCollectionId(normalizedFavorites.defaultFavoriteCollectionId)
  }
  await Promise.all(tasks
    .filter((task, index) => normalizedFavorites.changed || interruptedTaskIds.has(task.id) || task.rawResponsePayload !== markedTasks[index]?.rawResponsePayload)
    .map((task) => putTask(task)))
  useStore.getState().setTasks(tasks)
  for (const task of tasks) {
    if (
      task.apiProvider === 'fal' &&
      task.falRequestId &&
      task.falEndpoint &&
      (task.status === 'running' || task.falRecoverable)
    ) {
      scheduleFalRecovery(task.id, 0)
    }
    if (
      task.customTaskId &&
      (task.status === 'running' || task.customRecoverable)
    ) {
      scheduleCustomRecovery(task.id, 0)
    }
  }

  // 收集所有任务引用的图片 id
  const referencedIds = new Set<string>()
  const state = useStore.getState()
  const persistedInputImages = state.inputImages
  const galleryInputDraft = state.galleryInputDraft
  for (const img of persistedInputImages) referencedIds.add(img.id)
  if (galleryInputDraft) {
    for (const img of galleryInputDraft.inputImages) referencedIds.add(img.id)
  }
  for (const t of tasks) {
    addTaskReferencedImageIds(referencedIds, t)
  }

  // 只枚举 key 清理孤立图片，避免启动时把所有 4K 原图读进内存。
  const imageIds = await getAllImageIds()
  const referencedImageIds: string[] = []
  for (const imgId of imageIds) {
    if (referencedIds.has(imgId)) {
      referencedImageIds.push(imgId)
    } else {
      await deleteImage(imgId)
    }
  }
  scheduleThumbnailBackfill(referencedImageIds)

  const restoredInputImages: InputImage[] = []
  for (const img of persistedInputImages) {
    if (img.dataUrl) {
      restoredInputImages.push(img)
      cacheImage(img.id, img.dataUrl)
      continue
    }
    const storedImage = await getImage(img.id)
    if (storedImage?.dataUrl) {
      restoredInputImages.push({ ...img, dataUrl: storedImage.dataUrl })
      cacheImage(img.id, storedImage.dataUrl)
    }
  }
  if (restoredInputImages.length !== persistedInputImages.length || restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)) {
    useStore.getState().setInputImages(restoredInputImages)
  }

  if (galleryInputDraft) {
    const restoredGalleryImages: InputImage[] = []
    for (const img of galleryInputDraft.inputImages) {
      if (img.dataUrl) {
        restoredGalleryImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = await getImage(img.id)
      if (storedImage?.dataUrl) {
        restoredGalleryImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }
    const shouldClearMask = Boolean(galleryInputDraft.maskDraft) && !restoredGalleryImages.some((img) => img.id === galleryInputDraft.maskDraft?.targetImageId)
    const restoredGalleryDraft: InputDraft = {
      ...galleryInputDraft,
      inputImages: restoredGalleryImages,
      prompt: remapImageMentionsForOrder(galleryInputDraft.prompt, galleryInputDraft.inputImages, restoredGalleryImages),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    }
    const galleryDraftsChanged =
      restoredGalleryImages.length !== galleryInputDraft.inputImages.length ||
      restoredGalleryImages.some((img, index) => img.dataUrl !== galleryInputDraft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    if (galleryDraftsChanged) {
      const latestState = useStore.getState()
      const nextGalleryInputDraft = isEmptyInputDraft(restoredGalleryDraft) ? null : restoredGalleryDraft
      useStore.setState({
        galleryInputDraft: nextGalleryInputDraft,
        ...(latestState.appMode === 'gallery'
          ? restoreGalleryInputDraftState(nextGalleryInputDraft)
          : {}),
      })
    }
  }
}

/** 提交新任务 */
export async function submitTask(options: { allowFullMask?: boolean } = {}) {
  const { settings, prompt, inputImages, maskDraft, params, showToast, setConfirmDialog } =
    useStore.getState()

  const normalizedSettings = normalizeSettings(settings)

  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: () => {
            void submitTask({ allowFullMask: true })
          },
        })
        return
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  const normalizedParams = normalizeParamsForSettings(params, normalizedSettings, { hasInputImages: orderedInputImages.length > 0 })
  const shouldUseTransparentOutput = normalizedParams.output_format === 'png' && normalizedParams.transparent_output
  const taskParams = shouldUseTransparentOutput
    ? getTransparentRequestParams(normalizedParams)
    : { ...normalizedParams, transparent_output: false }
  const transparentMeta = taskParams.transparent_output
    ? createTransparentOutputMeta(prompt.trim())
    : null
  const normalizedParamPatch = getChangedParams(params, taskParams)
  if (Object.keys(normalizedParamPatch).length) {
    useStore.getState().setParams(normalizedParamPatch)
  }

  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: taskParams,
    inputImageIds: orderedInputImages.map((i) => i.id),
    maskTargetImageId,
    maskImageId,
    transparentOutput: transparentMeta?.transparentOutput,
    transparentPrompt: transparentMeta?.effectivePrompt,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([task, ...latestTasks])
  await putTask(task)
  useStore.getState().showToast('任务已提交', 'success')

  if (settings.clearInputAfterSubmit) {
    useStore.getState().setPrompt('')
    useStore.getState().clearInputImages()
  }

  // 异步调用 API
  executeTask(taskId)
}

function addTaskReferencedImageIds(target: Set<string>, task: TaskRecord) {
  for (const id of task.inputImageIds || []) target.add(id)
  if (task.maskImageId) target.add(task.maskImageId)
  for (const id of task.outputImages || []) target.add(id)
  for (const id of task.transparentOriginalImages || []) {
    if (id) target.add(id)
  }
  for (const id of task.streamPartialImageIds || []) target.add(id)
}

function addInputDraftReferencedImageIds(target: Set<string>, draft: InputDraft | null) {
  if (!draft) return
  for (const img of draft.inputImages) target.add(img.id)
  if (draft.maskDraft?.targetImageId) target.add(draft.maskDraft.targetImageId)
}

async function storeTaskOutputImages(task: TaskRecord, images: string[]) {
  const outputIds: string[] = []
  const outputDataUrls: string[] = []
  const outputImageSizes: Array<{ width?: number; height?: number }> = []
  const transparentOriginalImageIds: string[] = []
  const storedImageIds: string[] = []

  try {
    for (const dataUrl of images) {
      let outputDataUrl = dataUrl
      if (task.transparentOutput) {
        const original = await storeImageWithSize(dataUrl, 'generated')
        storedImageIds.push(original.id)
        cacheImage(original.id, dataUrl)

        try {
          outputDataUrl = await removeKeyedBackgroundFromDataUrl(dataUrl)
          transparentOriginalImageIds.push(original.id)
        } catch (err) {
          console.warn('透明背景后处理失败，已回退为原始输出', err)
          outputIds.push(original.id)
          outputDataUrls.push(dataUrl)
          outputImageSizes.push(original)
          transparentOriginalImageIds.push('')
          continue
        }
      }

      const stored = await storeImageWithSize(outputDataUrl, 'generated')
      storedImageIds.push(stored.id)
      cacheImage(stored.id, outputDataUrl)
      outputIds.push(stored.id)
      outputDataUrls.push(outputDataUrl)
      outputImageSizes.push(stored)
    }

    return {
      outputIds,
      outputDataUrls,
      outputImageSizes,
      transparentOriginalImageIds: transparentOriginalImageIds.length ? transparentOriginalImageIds : undefined,
    }
  } catch (err) {
    await deleteUnreferencedImageIds(storedImageIds)
    throw err
  }
}

async function deleteUnreferencedImageIds(imageIds: Iterable<string>) {
  const candidates = Array.from(new Set(Array.from(imageIds).filter(Boolean)))
  if (candidates.length === 0) return

  const { tasks, inputImages, galleryInputDraft } = useStore.getState()
  const stillUsed = new Set<string>()
  for (const task of tasks) addTaskReferencedImageIds(stillUsed, task)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)

  for (const imgId of candidates) {
    if (stillUsed.has(imgId)) continue
    await deleteImage(imgId)
    imageCache.delete(imgId)
    thumbnailCache.delete(imgId)
  }
}

async function persistTaskStreamPartialImage(taskId: string, dataUrl: string) {
  try {
    const imgId = await storeImage(dataUrl, 'generated')
    cacheImage(imgId, dataUrl)

    const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
    if (!latestTask || latestTask.status === 'done') {
      await deleteUnreferencedImageIds([imgId])
      return
    }

    const currentIds = latestTask.streamPartialImageIds || []
    if (currentIds.includes(imgId)) return
    updateTaskInStore(taskId, { streamPartialImageIds: [...currentIds, imgId] })
  } catch (err) {
    console.error(err)
  }
}






async function executeTask(taskId: string) {
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return

  // TODO: call platform backend API for image generation
}

function normalizeFavoritePatch(task: TaskRecord, patch: Partial<TaskRecord>, defaultFavoriteCollectionId: string | null): Partial<TaskRecord> {
  if ('favoriteCollectionIds' in patch) {
    const ids = normalizeFavoriteCollectionIds(patch.favoriteCollectionIds)
    return { ...patch, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
  }
  if ('isFavorite' in patch) {
    if (patch.isFavorite) {
      const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds)
      return { ...patch, favoriteCollectionIds: ids.length ? ids : defaultFavoriteCollectionId ? [defaultFavoriteCollectionId] : [] }
    }
    return { ...patch, favoriteCollectionIds: [] }
  }
  return patch
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks, defaultFavoriteCollectionId } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...normalizeFavoritePatch(t, patch, defaultFavoriteCollectionId) } : t,
  )
  const task = updated.find((t) => t.id === taskId)
  setTasks(updated)
  if (task) putTask(task)
}

function normalizeFavoriteCollectionIds(ids: unknown) {
  if (!Array.isArray(ids)) return []
  return Array.from(new Set(ids.map(String).filter((id) => id && id !== ALL_FAVORITES_COLLECTION_ID)))
}

function sameFavoriteCollectionIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

export function getTaskFavoriteCollectionIds(task: TaskRecord) {
  const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds)
  if (ids.length > 0) return ids
  const defaultFavoriteCollectionId = useStore.getState().defaultFavoriteCollectionId
  return task.isFavorite && defaultFavoriteCollectionId ? [defaultFavoriteCollectionId] : []
}

function normalizeTaskFavoriteState(task: TaskRecord, collections: FavoriteCollection[]): TaskRecord {
  const collectionIdSet = new Set(collections.map((collection) => collection.id))
  const normalizedIds = normalizeFavoriteCollectionIds(task.favoriteCollectionIds).filter((id) => collectionIdSet.has(id))
  // 旧版本只有 isFavorite 没有 favoriteCollectionIds，迁移到"默认"收藏夹
  const defaultId = getDefaultNamedFavoriteCollectionId(collections)
  const ids = normalizedIds.length > 0 ? normalizedIds : task.isFavorite && defaultId ? [defaultId] : []
  const isFavorite = ids.length > 0 || Boolean(task.isFavorite)
  if (ids.length === (task.favoriteCollectionIds ?? []).length && ids.every((id, index) => id === task.favoriteCollectionIds?.[index]) && Boolean(task.isFavorite) === isFavorite) {
    return task
  }
  return { ...task, favoriteCollectionIds: ids, isFavorite }
}

function normalizeLoadedFavoriteState(tasks: TaskRecord[], collections: FavoriteCollection[], preferredDefaultFavoriteCollectionId: string | null) {
  let changed = false
  // 确保"默认"收藏夹存在，给孤立收藏任务一个归属
  const normalizedCollections = ensureDefaultNamedCollection(ensureDefaultFavoriteCollection(normalizeFavoriteCollections(collections)))
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(normalizedCollections, preferredDefaultFavoriteCollectionId)
  const normalizedTasks = tasks.map((task) => {
    const nextTask = normalizeTaskFavoriteState(task, normalizedCollections)
    if (nextTask !== task) changed = true
    return nextTask
  })
  return { tasks: normalizedTasks, collections: normalizedCollections, defaultFavoriteCollectionId, changed }
}

export function getFavoriteCollectionTitle(collectionId: string | null, collections = useStore.getState().favoriteCollections) {
  if (collectionId === ALL_FAVORITES_COLLECTION_ID) return '全部'
  return collections.find((collection) => collection.id === collectionId)?.name ?? DEFAULT_FAVORITE_COLLECTION_NAME
}

export function createFavoriteCollection(name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName) return null
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast('收藏夹名称最多 60 个字符', 'error')
    return null
  }
  const state = useStore.getState()
  const existing = state.favoriteCollections.find((collection) => collection.name === normalizedName)
  if (existing) return existing
  const now = Date.now()
  const collection: FavoriteCollection = { id: genId(), name: normalizedName, createdAt: now, updatedAt: now }
  state.setFavoriteCollections([...state.favoriteCollections, collection])
  state.showToast(`已创建收藏夹「${normalizedName}」`, 'success')
  return collection
}

export function renameFavoriteCollection(collectionId: string, name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast('收藏夹名称最多 60 个字符', 'error')
    return
  }
  const { favoriteCollections, setFavoriteCollections, showToast } = useStore.getState()
  setFavoriteCollections(favoriteCollections.map((collection) =>
    collection.id === collectionId ? { ...collection, name: normalizedName, updatedAt: Date.now() } : collection,
  ))
  showToast('收藏夹名称已更新', 'success')
}

export async function updateTasksFavoriteCollections(taskIds: string[], collectionIds: string[]) {
  const ids = normalizeFavoriteCollectionIds(collectionIds)
  const uniqueTaskIds = Array.from(new Set(taskIds)).filter(Boolean)
  if (!uniqueTaskIds.length) return
  const { tasks, setTasks, clearSelection, showToast } = useStore.getState()
  const idSet = new Set(uniqueTaskIds)
  const changedTaskIds = new Set<string>()
  const updated = tasks.map((task) => {
    if (!idSet.has(task.id)) return task
    if (sameFavoriteCollectionIds(getTaskFavoriteCollectionIds(task), ids)) return task
    changedTaskIds.add(task.id)
    return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
  })
  if (!changedTaskIds.size) {
    clearSelection()
    return
  }
  setTasks(updated)
  await Promise.all(updated.filter((task) => changedTaskIds.has(task.id)).map((task) => putTask(task)))
  clearSelection()
  showToast(ids.length ? '收藏夹已更新' : '已取消收藏', 'success')
}

export async function deleteFavoriteCollection(collectionId: string, deleteTasks = false) {
  if (!collectionId || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  const state = useStore.getState()
  const collection = state.favoriteCollections.find((item) => item.id === collectionId)
  if (!collection || state.favoriteCollections.length <= 1) return
  const collectionTaskRefs = state.tasks
    .map((task) => ({ task, favoriteIds: getTaskFavoriteCollectionIds(task) }))
    .filter(({ favoriteIds }) => favoriteIds.includes(collectionId))
  const taskIds = collectionTaskRefs.map(({ task }) => task.id)
  const nextCollections = state.favoriteCollections.filter((item) => item.id !== collectionId)
  const nextCollectionIdSet = new Set(nextCollections.map((item) => item.id))
  state.setFavoriteCollections(nextCollections)
  if (state.defaultFavoriteCollectionId === collectionId) {
    const nextDefaultId = nextCollections[0]?.id
    if (nextDefaultId) useStore.getState().setDefaultFavoriteCollectionId(nextDefaultId)
  }
  if (state.activeFavoriteCollectionId === collectionId) state.setActiveFavoriteCollectionId(null)
  if (deleteTasks) {
    const idsByTaskToKeep = new Map<string, string[]>()
    const taskIdsToDelete: string[] = []
    for (const { task, favoriteIds } of collectionTaskRefs) {
      const nextIds = favoriteIds.filter((id) => id !== collectionId && nextCollectionIdSet.has(id))
      if (nextIds.length) {
        idsByTaskToKeep.set(task.id, nextIds)
      } else {
        taskIdsToDelete.push(task.id)
      }
    }
    if (idsByTaskToKeep.size) {
      const latestTasks = useStore.getState().tasks
      const updated = latestTasks.map((task) => {
        const ids = idsByTaskToKeep.get(task.id)
        return ids ? { ...task, favoriteCollectionIds: ids, isFavorite: true } : task
      })
      useStore.getState().setTasks(updated)
      await Promise.all(updated.filter((task) => idsByTaskToKeep.has(task.id)).map((task) => putTask(task)))
    }
    if (taskIdsToDelete.length) await removeMultipleTasks(taskIdsToDelete)
  } else if (taskIds.length) {
    const idsByTaskId = new Map(collectionTaskRefs.map(({ task, favoriteIds }) => [
      task.id,
      favoriteIds.filter((id) => id !== collectionId && nextCollectionIdSet.has(id)),
    ]))
    const updated = state.tasks.map((task) => {
      const ids = idsByTaskId.get(task.id)
      if (!ids) return task
      return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
    })
    state.setTasks(updated)
    await Promise.all(updated.filter((task) => idsByTaskId.has(task.id)).map((task) => putTask(task)))
  }
  useStore.getState().setSelectedFavoriteCollectionIds((ids) => ids.filter((id) => id !== collectionId))
  useStore.getState().showToast(`已删除收藏夹「${collection.name}」`, 'success')
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  const { settings } = useStore.getState()
  const normalizedParams = normalizeParamsForSettings(task.params, settings, { hasInputImages: task.inputImageIds.length > 0 })
  const shouldUseTransparentOutput = normalizedParams.output_format === 'png' && normalizedParams.transparent_output
  const taskParams = shouldUseTransparentOutput
    ? getTransparentRequestParams(normalizedParams)
    : { ...normalizedParams, transparent_output: false }
  const transparentMeta = taskParams.transparent_output
    ? createTransparentOutputMeta(task.prompt.trim())
    : null
  const taskId = genId()
  const newTask: TaskRecord = {
    id: taskId,
    prompt: task.prompt,
    params: taskParams,
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    transparentOutput: transparentMeta?.transparentOutput,
    transparentPrompt: transparentMeta?.effectivePrompt,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([newTask, ...latestTasks])
  await putTask(newTask)

  executeTask(taskId)
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks, inputImages, galleryInputDraft, showToast, selectedTaskIds } = useStore.getState()
  
  if (!taskIds.length) return

  const toDelete = new Set(taskIds)
  const deletedTasks = tasks.filter(t => toDelete.has(t.id))
  const remaining = tasks.filter(t => !toDelete.has(t.id))

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      addTaskReferencedImageIds(deletedImageIds, t)
    }
  }

  setTasks(remaining)
  for (const id of taskIds) {
    await dbDeleteTask(id)
  }

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    addTaskReferencedImageIds(stillUsed, t)
  }
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of deletedImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
      thumbnailCache.delete(imgId)
    }
  }

  // 如果删除的任务在选中列表中，则移除
  const newSelection = selectedTaskIds.filter(id => !toDelete.has(id))
  if (newSelection.length !== selectedTaskIds.length) {
    useStore.getState().setSelectedTaskIds(newSelection)
  }

  showToast(`已删除 ${taskIds.length} 个任务`, 'success')
}

/** 删除所有失败任务 */
export async function clearFailedTasks(taskIds?: string[]) {
  const targetTaskIds = taskIds ? new Set(taskIds) : null
  const failedTasks = useStore.getState().tasks
    .filter((task) => taskMatchesFilterStatus(task, 'error') && (!targetTaskIds || targetTaskIds.has(task.id)))
  const failedTaskIds = failedTasks
    .filter((task) => task.status === 'error')
    .map((task) => task.id)
  const partialFailedTaskIds = new Set(
    failedTasks
      .filter((task) => task.status !== 'error' && taskHasOutputErrors(task))
      .map((task) => task.id),
  )

  if (failedTaskIds.length) await removeMultipleTasks(failedTaskIds)
  if (partialFailedTaskIds.size) {
    const { tasks, setTasks, selectedTaskIds, setSelectedTaskIds, showToast } = useStore.getState()
    const updated = tasks.map((task) => partialFailedTaskIds.has(task.id) ? { ...task, outputErrors: undefined } : task)
    setTasks(updated)
    const nextSelectedTaskIds = selectedTaskIds.filter((id) => !partialFailedTaskIds.has(id))
    if (nextSelectedTaskIds.length !== selectedTaskIds.length) setSelectedTaskIds(nextSelectedTaskIds)
    await Promise.all(updated.filter((task) => partialFailedTaskIds.has(task.id)).map((task) => putTask(task)))
    showToast(`已清除 ${partialFailedTaskIds.size} 条部分失败记录`, 'success')
  }
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, inputImages, galleryInputDraft, showToast } = useStore.getState()

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
    ...(task.transparentOriginalImages || []),
    ...(task.streamPartialImageIds || []),
  ])

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== task.id)
  setTasks(remaining)
  await dbDeleteTask(task.id)

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    addTaskReferencedImageIds(stillUsed, t)
  }
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
      thumbnailCache.delete(imgId)
    }
  }

  showToast('任务已删除', 'success')
}

/** 清空数据选项 */
export interface ClearOptions {
  clearConfig?: boolean
  clearTasks?: boolean
}

/** 清空数据 */
export async function clearData(options: ClearOptions = { clearConfig: true, clearTasks: true }) {
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, showToast } = useStore.getState()

  if (options.clearTasks) {
    await dbClearTasks()
    await clearImages()
    imageCache.clear()
    thumbnailCache.clear()
    thumbnailBackfillIds.clear()
    setTasks([])
    clearInputImages()
    clearMaskDraft()
  }

  if (options.clearConfig) {
    useStore.setState({ dismissedCodexCliPrompts: [] })
    setSettings({ ...DEFAULT_SETTINGS })
    setParams({ ...DEFAULT_PARAMS })
  }

  showToast('所选数据已清空', 'success')
}

async function completeRecoveredCustomTask(task: TaskRecord, result: Awaited<ReturnType<typeof getCustomQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return
  if (latest.status !== 'running' && !latest.customRecoverable) return

  const { outputIds, outputDataUrls, outputImageSizes, transparentOriginalImageIds } = await storeTaskOutputImages(task, result.images)
  const actualParamsList = await resolveImageSizeParamsList(outputDataUrls, undefined, outputImageSizes)
  const latestBeforeUpdate = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latestBeforeUpdate || latestBeforeUpdate.status === 'done' || (latestBeforeUpdate.status !== 'running' && !latestBeforeUpdate.customRecoverable)) {
    await deleteUnreferencedImageIds([...outputIds, ...(transparentOriginalImageIds ?? [])])
    return
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    transparentOriginalImages: transparentOriginalImageIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    status: 'done',
    error: null,
    customRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
  })
  useStore.getState().showToast(`自定义异步任务已恢复，共 ${outputIds.length} 张图片`, 'success')
  showTaskCompletionNotification('图像生成完成', `自定义异步任务已恢复，共 ${outputIds.length} 张图片。`)
}

async function recoverCustomTask(taskId: string) {
  const { tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || !task.customTaskId || task.status === 'done') return

  scheduleCustomRecovery(taskId)
}

/** 导出选项 */
export interface ExportOptions {
  exportConfig?: boolean
  exportTasks?: boolean
}

/** 导出数据为 ZIP */
export async function exportData(options: ExportOptions = { exportConfig: true, exportTasks: true }) {
  try {
    const tasks = options.exportTasks ? await getAllTasks() : []
    const images = options.exportTasks ? await getAllImages() : []
    const { settings, favoriteCollections, defaultFavoriteCollectionId } = useStore.getState()
    const exportedAt = Date.now()
    const thumbnailsByImageId = new Map<string, NonNullable<Awaited<ReturnType<typeof getImageThumbnail>>>>()

    if (options.exportTasks) {
      for (const img of images) {
        const thumbnail = await getImageThumbnail(img.id)
        if (thumbnail?.thumbnailDataUrl) {
          thumbnailsByImageId.set(img.id, thumbnail)
          cacheThumbnail(img.id, {
            dataUrl: thumbnail.thumbnailDataUrl,
            width: thumbnail.width,
            height: thumbnail.height,
            thumbnailVersion: thumbnail.thumbnailVersion,
          })
        }
      }
    }

    const { bytes: zipped } = buildExportZip({
      options,
      exportedAt,
      settings,
      tasks,
      images,
      thumbnailsByImageId,
      favoriteCollections,
      defaultFavoriteCollectionId,
    })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pixel-engine-backup_${formatExportFileTime(new Date(exportedAt))}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast('数据已导出', 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 导入选项 */
export interface ImportOptions {
  importConfig?: boolean
  importTasks?: boolean
}

/** 导入 ZIP 数据 */
export async function importData(file: File, options: ImportOptions = { importConfig: true, importTasks: true }): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer()
    const { manifest: data, files } = readExportZip(new Uint8Array(buffer))

    const importedImageIds: string[] = []
    if (options.importTasks && data.tasks && data.imageFiles) {
      // 还原图片
      for (const [id, info] of Object.entries(data.imageFiles)) {
        const dataUrl = readExportZipFileAsDataUrl(files, info.path)
        if (!dataUrl) continue
        await putImage({
          id,
          dataUrl,
          createdAt: info.createdAt,
          source: info.source,
          width: info.width,
          height: info.height,
        })
        cacheImage(id, dataUrl)
        importedImageIds.push(id)
      }

      for (const [id, info] of Object.entries(data.thumbnailFiles ?? {})) {
        const thumbnailDataUrl = readExportZipFileAsDataUrl(files, info.path)
        if (!thumbnailDataUrl) continue
        await putImageThumbnail({
          id,
          thumbnailDataUrl,
          width: info.width,
          height: info.height,
          thumbnailVersion: info.thumbnailVersion,
        })
        cacheThumbnail(id, {
          dataUrl: thumbnailDataUrl,
          width: info.width,
          height: info.height,
          thumbnailVersion: info.thumbnailVersion,
        })
      }

      for (const task of data.tasks) {
        await putTask(task)
      }

      const tasks = await getAllTasks()
      const state = useStore.getState()
      const importedCollections = normalizeFavoriteCollections(data.favoriteCollections)
      const favoriteCollections = importedCollections.length
        ? ensureDefaultFavoriteCollection(normalizeFavoriteCollections([...state.favoriteCollections, ...importedCollections]))
        : state.favoriteCollections
      const defaultFavoriteCollectionId = importedCollections.length
        ? resolveDefaultFavoriteCollectionId(favoriteCollections, data.defaultFavoriteCollectionId)
        : state.defaultFavoriteCollectionId
      const normalizedFavorites = normalizeLoadedFavoriteState(tasks, favoriteCollections, defaultFavoriteCollectionId)
      useStore.setState({
        tasks: normalizedFavorites.tasks,
        favoriteCollections: normalizedFavorites.collections,
        defaultFavoriteCollectionId: normalizedFavorites.defaultFavoriteCollectionId,
      })
      if (normalizedFavorites.changed) await Promise.all(normalizedFavorites.tasks.map((task) => putTask(task)))
      scheduleThumbnailBackfill(importedImageIds)
    }

    if (options.importConfig && data.settings) {
      const state = useStore.getState()
      state.setSettings(mergeImportedSettings(state.settings, data.settings))
    }

    let msg = '数据已成功导入'
    if (options.importTasks && data.tasks) {
      msg = `已导入 ${data.tasks.length} 个任务`
    } else if (options.importConfig && data.settings) {
      msg = '配置已成功导入'
    }

    useStore.getState().showToast(msg, 'success')
    return true
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导入失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    return false
  }
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  const image = await createInputImageFromFile(file)
  if (!image) return
  useStore.getState().addInputImage(image)
}

export async function createInputImageFromFile(file: File): Promise<InputImage | null> {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await fileToDataUrl(file)
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  return { id, dataUrl }
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
  const dataUrl = await blobToDataUrl(blob)
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

