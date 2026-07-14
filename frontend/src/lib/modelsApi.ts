import { z } from 'zod'
import { apiFetch } from './apiClient'

export const platformModelSchema = z.object({
  platform_model_id: z.string(),
  display_name: z.string(),
  provider_slug: z.string(),
  unit_price: z.number().int(),
  supports_edit: z.boolean(),
  supports_size: z.boolean(),
  supports_quality: z.boolean(),
  supports_n: z.boolean(),
  max_n: z.number().int(),
})

export type PlatformModel = z.infer<typeof platformModelSchema>

const modelsResponseSchema = z.array(platformModelSchema)

export async function fetchPlatformModels(): Promise<PlatformModel[]> {
  const data = await apiFetch('/api/models', { method: 'GET' })
  return modelsResponseSchema.parse(data)
}
