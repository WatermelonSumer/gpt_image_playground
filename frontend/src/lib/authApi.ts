import { z } from 'zod'
import { appConfig } from './appConfig'

export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['user', 'super_admin']),
  status: z.enum(['active', 'disabled']),
  forcePasswordChange: z.boolean(),
})

export const authResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('bearer'),
  expiresIn: z.number().int().positive(),
  user: authUserSchema,
})

const errorResponseSchema = z.object({
  detail: z.string(),
})

export type AuthUser = z.infer<typeof authUserSchema>
export type AuthResponse = z.infer<typeof authResponseSchema>

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AuthApiError'
  }
}

async function requestAuth(path: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetch(`${appConfig.backendUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })
  } catch (err) {
    console.warn('登录服务连接失败:', err)
    throw new Error('无法连接登录服务，请检查后端是否已启动')
  }

  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(data)
    throw new AuthApiError(parsed.success ? parsed.data.detail : `登录服务请求失败：${response.status}`, response.status)
  }
  return data
}

export async function login(email: string, password: string) {
  const data = await requestAuth('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  return authResponseSchema.parse(data)
}

export async function refreshSession() {
  const data = await requestAuth('/api/auth/refresh', { method: 'POST' })
  return authResponseSchema.parse(data)
}

export async function logoutSession() {
  await requestAuth('/api/auth/logout', { method: 'POST' })
}
