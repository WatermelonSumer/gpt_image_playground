import { z } from 'zod'

const appConfigSchema = z.object({
  backendUrl: z.union([z.literal(''), z.string().url()]),
})

export const appConfig = appConfigSchema.parse({
  backendUrl: (import.meta.env.VITE_BACKEND_URL ?? '').trim().replace(/\/+$/, ''),
})
