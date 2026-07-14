import type { ReactNode } from 'react'

// 共享样式常量，保持与全局设计一致
export const inputClass =
  'w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm text-gray-700 dark:text-gray-200 outline-none focus:border-blue-400/60 dark:focus:border-blue-400/40 transition-colors'

export const selectClass =
  'w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm text-gray-700 dark:text-gray-200 outline-none'

export const cardClass =
  'rounded-2xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] p-4'

export const primaryBtnClass =
  'bg-blue-500 text-white hover:bg-blue-600 rounded-xl px-4 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

export const dangerBtnClass =
  'bg-red-500 text-white hover:bg-red-600 rounded-xl px-4 py-2 text-sm transition-colors'

export const ghostBtnClass =
  'rounded-xl px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 border border-gray-200/60 dark:border-white/[0.08] hover:bg-gray-100/60 dark:hover:bg-white/[0.06] transition-colors'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-gray-500 dark:text-gray-400">{label}</span>
      {children}
    </label>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 dark:border-white/20 accent-blue-500"
      />
      <span>{label}</span>
    </label>
  )
}
