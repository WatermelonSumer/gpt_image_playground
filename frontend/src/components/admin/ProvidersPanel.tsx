import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { ApiError } from '../../lib/apiClient'
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  type Provider,
} from '../../lib/adminApi'
import { Field, cardClass, inputClass, primaryBtnClass, ghostBtnClass } from './adminUi'

export default function ProvidersPanel() {
  const showToast = useStore((s) => s.showToast)
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setProviders(await listProviders())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const resetCreate = () => {
    setCreating(false)
    setName('')
    setSlug('')
  }

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) {
      showToast('请填写名称与 slug', 'error')
      return
    }
    setSubmitting(true)
    try {
      await createProvider({ name: name.trim(), slug: slug.trim() })
      resetCreate()
      await load()
      showToast('厂商已创建', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '创建失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (p: Provider) => {
    setEditingId(p.id)
    setEditName(p.name)
    setEditSlug(p.slug)
  }

  const handleUpdate = async (id: string) => {
    if (!editName.trim() || !editSlug.trim()) {
      showToast('请填写名称与 slug', 'error')
      return
    }
    setSubmitting(true)
    try {
      await updateProvider(id, { name: editName.trim(), slug: editSlug.trim() })
      setEditingId(null)
      await load()
      showToast('厂商已更新', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '更新失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (p: Provider) => {
    if (!window.confirm(`确定删除厂商「${p.name}」？其下渠道和模型会一并删除`)) return
    try {
      await deleteProvider(p.id)
      await load()
      showToast('厂商已删除', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '删除失败', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-gray-800 dark:text-gray-200">厂商</h2>
        {!creating && (
          <button type="button" className={primaryBtnClass} onClick={() => setCreating(true)}>
            新建厂商
          </button>
        )}
      </div>

      {creating && (
        <div className={cardClass}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名称">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 OpenAI" />
            </Field>
            <Field label="slug">
              <input className={inputClass} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="例如 openai" />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className={primaryBtnClass} disabled={submitting} onClick={() => void handleCreate()}>
              {submitting ? '提交中…' : '创建'}
            </button>
            <button type="button" className={ghostBtnClass} onClick={resetCreate}>
              取消
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">加载中…</div>
      ) : error ? (
        <div className="text-sm text-red-500">{error}</div>
      ) : providers.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">暂无数据</div>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => (
            <div key={p.id} className={cardClass}>
              {editingId === p.id ? (
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="名称">
                      <input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </Field>
                    <Field label="slug">
                      <input className={inputClass} value={editSlug} onChange={(e) => setEditSlug(e.target.value)} />
                    </Field>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button" className={primaryBtnClass} disabled={submitting} onClick={() => void handleUpdate(p.id)}>
                      {submitting ? '保存中…' : '保存'}
                    </button>
                    <button type="button" className={ghostBtnClass} onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-gray-800 dark:text-gray-200">{p.name}</div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">{p.slug}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className={ghostBtnClass} onClick={() => startEdit(p)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className="rounded-xl px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      onClick={() => void handleDelete(p)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
