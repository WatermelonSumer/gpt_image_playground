import { create } from 'zustand'
import { fetchPlatformModels, type PlatformModel } from './lib/modelsApi'

type ModelsState = {
  models: PlatformModel[]
  status: 'idle' | 'loading' | 'loaded' | 'error'
  error: string | null
  load: () => Promise<void>
  getModel: (platformModelId: string) => PlatformModel | undefined
}

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: [],
  status: 'idle',
  error: null,
  load: async () => {
    if (get().status === 'loading') return
    set({ status: 'loading', error: null })
    try {
      const models = await fetchPlatformModels()
      set({ models, status: 'loaded', error: null })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : '加载模型列表失败' })
    }
  },
  getModel: (platformModelId) => get().models.find((m) => m.platform_model_id === platformModelId),
}))
