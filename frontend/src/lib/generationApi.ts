import { z } from 'zod'
import { apiFetch } from './apiClient'

const generatedImageSchema = z.object({
  b64_json: z.string(),
  revised_prompt: z.string().nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
})

export const generationResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'done', 'error']),
  platform_model_id: z.string(),
  display_name: z.string(),
  unit_price: z.number().int(),
  requested_n: z.number().int(),
  charged_credits: z.number().int(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  result_images: z.array(generatedImageSchema).nullable().optional(),
  balance: z.number().int().nullable().optional(),
})

export type GenerationResponse = z.infer<typeof generationResponseSchema>
export type GeneratedImage = z.infer<typeof generatedImageSchema>

export interface CreateGenerationInput {
  platformModelId: string
  prompt: string
  params: {
    size: string
    quality: string
    output_format: string
    output_compression: number | null
    moderation: string
    n: number
    transparent_output: boolean
  }
  inputImages?: string[]
  maskImage?: string | null
}

export async function createGeneration(input: CreateGenerationInput): Promise<GenerationResponse> {
  const data = await apiFetch('/api/generations', {
    method: 'POST',
    body: JSON.stringify({
      platform_model_id: input.platformModelId,
      prompt: input.prompt,
      params: input.params,
      input_images: input.inputImages ?? [],
      mask_image: input.maskImage ?? null,
    }),
  })
  return generationResponseSchema.parse(data)
}

export async function getGeneration(id: string): Promise<GenerationResponse> {
  const data = await apiFetch(`/api/generations/${id}`, { method: 'GET' })
  return generationResponseSchema.parse(data)
}
