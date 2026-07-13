import { create } from 'zustand'
import type { AuthUser } from './lib/authApi'
import { AuthApiError, login, logoutSession, refreshSession } from './lib/authApi'

type AuthSnapshot =
  | { status: 'checking' }
  | { status: 'anonymous'; submitting: boolean; error: string | null }
  | { status: 'authenticated'; user: AuthUser; accessToken: string }

type AuthStore = {
  auth: AuthSnapshot
  restoreSession: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

let restoreRequest: Promise<void> | null = null

export const useAuthStore = create<AuthStore>((set, get) => ({
  auth: { status: 'checking' },
  restoreSession: () => {
    if (restoreRequest) return restoreRequest

    restoreRequest = refreshSession()
      .then((session) => {
        set({ auth: { status: 'authenticated', user: session.user, accessToken: session.accessToken } })
      })
      .catch((err: unknown) => {
        const error = err instanceof AuthApiError && err.status === 401
          ? null
          : err instanceof Error
            ? err.message
            : '无法恢复登录状态'
        if (error) console.warn('恢复登录状态失败:', err)
        set({ auth: { status: 'anonymous', submitting: false, error } })
      })
      .finally(() => {
        restoreRequest = null
      })
    return restoreRequest
  },
  login: async (email, password) => {
    const auth = get().auth
    if (auth.status === 'anonymous' && auth.submitting) return
    set({ auth: { status: 'anonymous', submitting: true, error: null } })
    try {
      const session = await login(email.trim(), password)
      set({ auth: { status: 'authenticated', user: session.user, accessToken: session.accessToken } })
    } catch (err) {
      const error = err instanceof Error ? err.message : '登录失败'
      set({ auth: { status: 'anonymous', submitting: false, error } })
    }
  },
  logout: async () => {
    try {
      await logoutSession()
    } catch (err) {
      console.warn('退出登录请求失败:', err)
    }
    set({ auth: { status: 'anonymous', submitting: false, error: null } })
  },
}))
