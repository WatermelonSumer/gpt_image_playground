import { useAuthStore } from '../authStore'
import { appConfig } from './appConfig'
import { refreshSession } from './authApi'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function currentAccessToken(): string | null {
  const auth = useAuthStore.getState().auth
  return auth.status === 'authenticated' ? auth.accessToken : null
}

/**
 * 带 access token 调用后端。遇到 401 时尝试刷新一次会话后重试。
 * 返回解析后的 JSON（204 返回 null）。
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  { retryOn401 = true }: { retryOn401?: boolean } = {},
): Promise<T> {
  const token = currentAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${appConfig.backendUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    })
  } catch {
    throw new ApiError('无法连接服务器，请检查网络或后端是否已启动', 0)
  }

  if (response.status === 401 && retryOn401) {
    // access token 过期，用 HttpOnly refresh cookie 换新 token 后重试一次
    try {
      const session = await refreshSession()
      useAuthStore.setState({
        auth: { status: 'authenticated', user: session.user, accessToken: session.accessToken },
      })
    } catch {
      useAuthStore.setState({ auth: { status: 'anonymous', submitting: false, error: null } })
      throw new ApiError('登录状态已失效，请重新登录', 401)
    }
    return apiFetch<T>(path, init, { retryOn401: false })
  }

  const data: unknown = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? String((data as { detail: unknown }).detail) : null
    throw new ApiError(detail ?? `请求失败：${response.status}`, response.status)
  }
  return data as T
}
