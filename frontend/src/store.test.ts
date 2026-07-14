import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from './types'
import type { ExportData, StoredImage, StoredImageThumbnail, TaskRecord } from './types'
import { getSelectedImageMentionLabel } from './lib/promptImageMentions'
vi.mock('./lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  let imageSeq = 0

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    getAllTasks: async () => [...tasks.values()],
    putTask: async (task: TaskRecord) => {
      tasks.set(task.id, task)
      return task.id
    },
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    getImage: async (id: string) => images.get(id),
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    getAllImageIds: async () => [...images.keys()],
    getAllImages: async () => [...images.values()],
    putImage: async (image: StoredImage) => {
      images.set(image.id, image)
      return image.id
    },
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => {
      thumbnails.set(thumbnail.id, thumbnail)
      return thumbnail.id
    },
    deleteImage: async (id: string) => {
      images.delete(id)
      thumbnails.delete(id)
    },
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    storeImage: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      images.set(id, { id, dataUrl, source, createdAt: Date.now() })
      return id
    },
    storeImageWithSize: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      const size = dataUrl.match(/(\d+)x(\d+)/)
      const width = size ? Number(size[1]) : undefined
      const height = size ? Number(size[2]) : undefined
      images.set(id, { id, dataUrl, source, createdAt: Date.now(), width, height })
      return { id, width, height }
    },
  }
})
vi.mock('./lib/transparentImage', () => ({
  GREEN_KEY_COLOR: '#00FF00',
  MAGENTA_KEY_COLOR: '#FF00FF',
  createTransparentOutputMeta: vi.fn((prompt: string) => ({
    transparentOutput: true,
    effectivePrompt: `transparent:${prompt}`,
  })),
  getTransparentRequestParams: vi.fn((params: typeof DEFAULT_PARAMS) => ({
    ...params,
    output_format: 'png',
    output_compression: null,
    transparent_output: true,
  })),
  removeKeyedBackgroundFromDataUrl: vi.fn(async (dataUrl: string) => `transparent:${dataUrl}`),
}))
import { clearImages, clearTasks, getAllTasks, getImage, putImage, putTask as putDbTask } from './lib/db'
import { removeKeyedBackgroundFromDataUrl } from './lib/transparentImage'
import { clearFailedTasks, deleteFavoriteCollection, editOutputs, getErrorToastMessage, getPersistedState, importData, initStore, markInterruptedRunningTasks, migratePersistedState, removeTask, submitTask, taskMatchesFilterStatus, taskMatchesSearchQuery, useStore } from './store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function importFile(data: ExportData): File {
  const zipped = zipSync({ 'manifest.json': strToU8(JSON.stringify(data)) })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
  return { arrayBuffer: async () => buffer } as File
}

describe('error toast messages', () => {
  it('drops long error detail after the failure title', () => {
    expect(getErrorToastMessage('请求失败：接口拒绝了很长的提示词内容')).toBe('请求失败')
  })

  it('uses a generic message for long raw errors without a title', () => {
    expect(getErrorToastMessage(`invalid request ${'x'.repeat(90)}`)).toBe('操作失败，请查看详情')
  })
})

describe('favorite collection deletion', () => {
  const collectionA = { id: 'collection-a', name: '收藏夹 A', createdAt: 1, updatedAt: 1 }
  const collectionB = { id: 'collection-b', name: '收藏夹 B', createdAt: 1, updatedAt: 1 }

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    useStore.setState({
      tasks: [],
      favoriteCollections: [collectionA, collectionB],
      defaultFavoriteCollectionId: collectionA.id,
      activeFavoriteCollectionId: collectionA.id,
      selectedFavoriteCollectionIds: [collectionA.id],
      selectedTaskIds: [],
      inputImages: [],
      galleryInputDraft: null,
      showToast: vi.fn(),
    })
  })

  it('keeps tasks that are still referenced by another collection when deleting collection tasks', async () => {
    const sharedTask = task({
      id: 'shared-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id, collectionB.id],
    })
    const collectionOnlyTask = task({
      id: 'collection-only-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id],
    })
    useStore.setState({ tasks: [sharedTask, collectionOnlyTask] })
    await putDbTask(sharedTask)
    await putDbTask(collectionOnlyTask)

    await deleteFavoriteCollection(collectionA.id, true)

    const state = useStore.getState()
    expect(state.favoriteCollections.map((collection) => collection.id)).toEqual([collectionB.id])
    expect(state.activeFavoriteCollectionId).toBeNull()
    expect(state.selectedFavoriteCollectionIds).toEqual([])
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({
      id: sharedTask.id,
      isFavorite: true,
      favoriteCollectionIds: [collectionB.id],
    })
    expect((await getAllTasks()).map((item) => item.id)).toEqual([sharedTask.id])
  })
})

describe('data import', () => {
  beforeEach(async () => {
    useStore.setState({
      tasks: [],
      showToast: vi.fn(),
    })
  })

  it('restores favorite collections and default collection when importing task data', async () => {
    await clearTasks()
    const importedCollections = [
      { id: 'imported-collection-a', name: '导入收藏夹 A', createdAt: 1, updatedAt: 1 },
      { id: 'imported-collection-b', name: '导入收藏夹 B', createdAt: 2, updatedAt: 2 },
    ]
    const importedTask = task({
      id: 'imported-favorite-task',
      isFavorite: true,
      favoriteCollectionIds: [importedCollections[1].id],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [importedTask],
      favoriteCollections: importedCollections,
      defaultFavoriteCollectionId: importedCollections[1].id,
      imageFiles: {},
    }), { importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.favoriteCollections).toEqual(expect.arrayContaining(importedCollections))
    expect(state.defaultFavoriteCollectionId).toBe(importedCollections[1].id)
    expect(state.tasks.find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
    expect((await getAllTasks()).find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
  })
})
