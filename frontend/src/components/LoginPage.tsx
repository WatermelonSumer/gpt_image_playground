import { useState, type FormEvent } from 'react'
import { ArrowUpRight, CircleAlert, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from 'lucide-react'
import { useAuthStore } from '../authStore'
import LoginCanvas from './LoginCanvas'

export function AuthLoadingScreen() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
      <div className="login-form-enter flex items-center gap-3 rounded-xl border border-gray-200 bg-white/85 px-5 py-4 shadow-lg shadow-black/5 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/80 dark:shadow-black/30">
        <LoaderCircle className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
        <div>
          <div className="text-sm font-semibold">正在打开工作台</div>
          <div className="mt-1 font-mono text-[9px] uppercase text-gray-400">Restoring session</div>
        </div>
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
    <main className="relative min-h-dvh overflow-x-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-white">
      <LoginCanvas />

      <div className="pointer-events-none relative z-10 flex min-h-dvh flex-col p-4 sm:p-6 lg:p-8">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-base font-bold">像素引擎</div>
            <div className="mt-0.5 font-mono text-[8px] uppercase text-gray-400 dark:text-gray-500">PixelEngine</div>
          </div>
          <span className="font-mono text-[9px] text-gray-400 dark:text-gray-500">v{__APP_VERSION__}</span>
        </header>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6 lg:p-8">
          <section aria-labelledby="login-title" className="login-form-enter pointer-events-auto relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/80 bg-white/70 p-6 text-gray-900 shadow-[0_18px_60px_rgba(15,23,42,0.12)] backdrop-blur-2xl sm:p-8 dark:border-white/10 dark:bg-gray-900/70 dark:text-white dark:shadow-black/35">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,0.34),transparent_38%,rgba(37,99,235,0.035))] dark:bg-[linear-gradient(145deg,rgba(255,255,255,0.06),transparent_38%,rgba(59,130,246,0.035))]" aria-hidden="true" />
            <div className="relative">
              <div className="mb-8">
                <div className="mb-3 flex items-center gap-2 font-mono text-[9px] font-semibold uppercase text-blue-600 dark:text-blue-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                  Workspace online
                </div>
                <h2 id="login-title" className="text-3xl font-black leading-tight">欢迎回来</h2>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">使用邮箱和密码进入工作台。</p>
              </div>

              <form className="space-y-5" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-gray-700 dark:text-gray-300">邮箱</span>
                  <span className="group relative block">
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-blue-600 dark:group-focus-within:text-blue-400" aria-hidden="true" />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      required
                      disabled={submitting}
                      className="h-12 min-w-0 w-full rounded-xl border border-gray-200 bg-white/80 pl-11 pr-4 text-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-gray-400 hover:bg-white focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.05] dark:placeholder:text-gray-500 dark:hover:bg-white/[0.08] dark:focus:bg-white/[0.09]"
                      placeholder="name@example.com"
                    />
                  </span>
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-gray-700 dark:text-gray-300">密码</span>
                  <span className="group relative block">
                    <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-blue-600 dark:group-focus-within:text-blue-400" aria-hidden="true" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                      disabled={submitting}
                      className="h-12 min-w-0 w-full rounded-xl border border-gray-200 bg-white/80 pl-11 pr-12 text-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-gray-400 hover:bg-white focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.05] dark:placeholder:text-gray-500 dark:hover:bg-white/[0.08] dark:focus:bg-white/[0.09]"
                      placeholder="输入密码"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-gray-400 transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:text-white"
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      title={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </span>
                </label>

                {error && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/90 px-3.5 py-3 text-sm leading-5 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="login-glass-submit group relative flex h-12 w-full items-center justify-between overflow-hidden rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/15 transition-[transform,background-color,box-shadow] hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-blue-600/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:translate-y-0 disabled:cursor-not-allowed disabled:bg-blue-400 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
                >
                  <span className="relative z-10">{submitting ? '正在登录' : '进入工作台'}</span>
                  <span className="relative z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 transition-transform group-hover:translate-x-0.5">
                    {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                  </span>
                </button>
              </form>

              <div className="mt-8 flex items-center justify-between gap-4 border-t border-gray-200 pt-4 font-mono text-[9px] text-gray-400 dark:border-white/10 dark:text-gray-500">
                <span>SECURE SESSION</span>
                <span>PIXELENGINE / {new Date().getFullYear()}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
