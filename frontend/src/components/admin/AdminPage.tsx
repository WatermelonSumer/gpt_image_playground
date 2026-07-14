import { useState } from 'react'
import { Link } from 'react-router-dom'
import ProvidersPanel from './ProvidersPanel'
import ChannelsPanel from './ChannelsPanel'
import ModelsPanel from './ModelsPanel'

type Tab = 'providers' | 'channels' | 'models'

const TABS: { key: Tab; label: string }[] = [
  { key: 'providers', label: '厂商' },
  { key: 'channels', label: '渠道' },
  { key: 'models', label: '模型池' },
]

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('providers')

  return (
    <div className="min-h-screen text-gray-900 dark:text-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            ← 返回工作台
          </Link>
          <h1 className="text-lg font-semibold">管理控制台</h1>
        </div>

        <div className="mt-6 flex gap-1 rounded-2xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-xl px-4 py-1.5 text-sm transition-colors ${
                tab === t.key
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100/60 dark:hover:bg-white/[0.06]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === 'providers' && <ProvidersPanel />}
          {tab === 'channels' && <ChannelsPanel />}
          {tab === 'models' && <ModelsPanel />}
        </div>
      </div>
    </div>
  )
}
