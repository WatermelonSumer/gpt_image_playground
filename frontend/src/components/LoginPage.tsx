import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, LoaderCircle, LogIn } from 'lucide-react'
import { useAuthStore } from '../authStore'

const PIXELS = [
  'bg-blue-600', 'bg-cyan-400', 'bg-gray-200 dark:bg-gray-800', 'bg-orange-500',
  'bg-gray-900 dark:bg-gray-100', 'bg-blue-200 dark:bg-blue-900', 'bg-emerald-500', 'bg-gray-300 dark:bg-gray-700',
  'bg-violet-500', 'bg-gray-100 dark:bg-gray-900', 'bg-blue-500', 'bg-rose-500',
  'bg-gray-300 dark:bg-gray-700', 'bg-amber-400', 'bg-gray-900 dark:bg-gray-100', 'bg-cyan-600',
] as const

export function AuthLoadingScreen() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="flex items-center gap-3 text-sm font-medium text-gray-600 dark:text-gray-400">
        <LoaderCircle className="h-5 w-5 animate-spin text-blue-600" aria-hidden="true" />
        正在恢复登录状态
      </div>
    </main>
  )
}

export default function LoginPage() {
  const auth = useAuthStore((state) => state.auth)
  const login = useAuthStore((state) => state.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const submitting = auth.status === 'anonymous' && auth.submitting
  const error = auth.status === 'anonymous' ? auth.error : null

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void login(email, password)
  }

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100 lg:grid-cols-[minmax(320px,0.85fr)_minmax(520px,1.15fr)]">
      <aside className="relative hidden overflow-hidden border-r border-gray-200 bg-gray-50 p-10 dark:border-white/[0.08] dark:bg-gray-900 lg:flex lg:flex-col lg:justify-between">
        <div>
          <div className="font-mono text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">PixelEngine</div>
          <div className="mt-2 text-2xl font-bold">像素引擎</div>
        </div>

        <div className="mx-auto w-full max-w-sm">
          <div className="grid aspect-square grid-cols-4 gap-2" aria-hidden="true">
            {PIXELS.map((color, idx) => (
              <div key={`${color}-${idx}`} className={`${color} min-h-0 border border-black/5 dark:border-white/5`} />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-gray-300 pt-3 font-mono text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <span>IMAGE WORKSPACE</span>
            <span>16 / 16</span>
          </div>
        </div>

        <div className="font-mono text-xs text-gray-500 dark:text-gray-400">统一图片生成平台</div>
      </aside>

      <section className="flex min-h-dvh min-w-0 items-center justify-center px-6 py-12 sm:px-10">
        <div className="min-w-0 w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <div className="font-mono text-xs font-semibold uppercase text-blue-600">PixelEngine</div>
            <div className="mt-1 text-xl font-bold">像素引擎</div>
            <div className="mt-5 grid h-2 grid-cols-4 gap-1" aria-hidden="true">
              <div className="bg-blue-600" />
              <div className="bg-orange-500" />
              <div className="bg-emerald-500" />
              <div className="bg-gray-900 dark:bg-gray-100" />
            </div>
          </div>

          <h1 className="text-2xl font-bold">登录</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">使用邮箱和密码进入工作台</p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium">邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                disabled={submitting}
                className="h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:focus:border-blue-500"
                placeholder="name@example.com"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium">密码</span>
              <span className="relative block">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                  className="h-11 w-full rounded-md border border-gray-300 bg-white px-3 pr-11 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:focus:border-blue-500"
                  placeholder="输入密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-500 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 dark:hover:text-gray-100"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  title={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>

            {error && (
              <div role="alert" className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-400 dark:focus-visible:ring-offset-gray-950"
            >
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {submitting ? '正在登录' : '登录'}
            </button>
          </form>

          <div className="mt-10 border-t border-gray-200 pt-4 font-mono text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-600">
            PixelEngine v{__APP_VERSION__}
          </div>
        </div>
      </section>
    </main>
  )
}
