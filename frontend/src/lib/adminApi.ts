import { z } from 'zod'
import { apiFetch } from './apiClient'

// ── Providers ────────────────────────────────────────────────────────────────

export const providerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
})
export type Provider = z.infer<typeof providerSchema>

export async function listProviders(): Promise<Provider[]> {
  return z.array(providerSchema).parse(await apiFetch('/api/admin/providers'))
}
export async function createProvider(input: { name: string; slug: string }): Promise<Provider> {
  return providerSchema.parse(await apiFetch('/api/admin/providers', { method: 'POST', body: JSON.stringify(input) }))
}
export async function updateProvider(id: string, input: Partial<{ name: string; slug: string }>): Promise<Provider> {
  return providerSchema.parse(await apiFetch(`/api/admin/providers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }))
}
export async function deleteProvider(id: string): Promise<void> {
  await apiFetch(`/api/admin/providers/${id}`, { method: 'DELETE' })
}

// ── Channels ─────────────────────────────────────────────────────────────────

export const channelSchema = z.object({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  name: z.string(),
  base_url: z.string(),
  has_api_key: z.boolean(),
  api_key_preview: z.string(),
  priority: z.number().int(),
  weight: z.number().int(),
  max_concurrent: z.number().int(),
  is_enabled: z.boolean(),
})
export type Channel = z.infer<typeof channelSchema>

export interface ChannelCreateInput {
  provider_id: string
  name: string
  base_url: string
  api_key: string
  priority?: number
  weight?: number
  max_concurrent?: number
  is_enabled?: boolean
}
export type ChannelUpdateInput = Partial<Omit<ChannelCreateInput, 'provider_id'>>

export async function listChannels(): Promise<Channel[]> {
  return z.array(channelSchema).parse(await apiFetch('/api/admin/channels'))
}
export async function createChannel(input: ChannelCreateInput): Promise<Channel> {
  return channelSchema.parse(await apiFetch('/api/admin/channels', { method: 'POST', body: JSON.stringify(input) }))
}
export async function updateChannel(id: string, input: ChannelUpdateInput): Promise<Channel> {
  return channelSchema.parse(await apiFetch(`/api/admin/channels/${id}`, { method: 'PATCH', body: JSON.stringify(input) }))
}
export async function deleteChannel(id: string): Promise<void> {
  await apiFetch(`/api/admin/channels/${id}`, { method: 'DELETE' })
}

// ── Platform models ──────────────────────────────────────────────────────────

export const platformModelSchema = z.object({
  id: z.string().uuid(),
  provider_id: z.string().uuid(),
  platform_model_id: z.string(),
  display_name: z.string(),
  upstream_model_id: z.string(),
  unit_price: z.number().int(),
  supports_edit: z.boolean(),
  supports_size: z.boolean(),
  supports_quality: z.boolean(),
  supports_n: z.boolean(),
  max_n: z.number().int(),
  is_enabled: z.boolean(),
})
export type AdminPlatformModel = z.infer<typeof platformModelSchema>

export interface ModelCreateInput {
  provider_id: string
  platform_model_id: string
  display_name: string
  upstream_model_id: string
  unit_price?: number
  supports_edit?: boolean
  supports_size?: boolean
  supports_quality?: boolean
  supports_n?: boolean
  max_n?: number
  is_enabled?: boolean
}
export type ModelUpdateInput = Partial<Omit<ModelCreateInput, 'provider_id' | 'platform_model_id'>>

export async function listPlatformModels(): Promise<AdminPlatformModel[]> {
  return z.array(platformModelSchema).parse(await apiFetch('/api/admin/platform-models'))
}
export async function createPlatformModel(input: ModelCreateInput): Promise<AdminPlatformModel> {
  return platformModelSchema.parse(await apiFetch('/api/admin/platform-models', { method: 'POST', body: JSON.stringify(input) }))
}
export async function updatePlatformModel(id: string, input: ModelUpdateInput): Promise<AdminPlatformModel> {
  return platformModelSchema.parse(await apiFetch(`/api/admin/platform-models/${id}`, { method: 'PATCH', body: JSON.stringify(input) }))
}
export async function deletePlatformModel(id: string): Promise<void> {
  await apiFetch(`/api/admin/platform-models/${id}`, { method: 'DELETE' })
}
