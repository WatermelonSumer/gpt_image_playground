import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { ApiError } from '../../lib/apiClient'
import Select from '../Select'
import {
  listChannels,
  listProviders,
  createChannel,
  updateChannel,
  deleteChannel,
  type Channel,
  type Provider,
  type ChannelCreateInput,
  type ChannelUpdateInput,
} from '../../lib/adminApi'
import { Field, cardClass, inputClass, selectClass, primaryBtnClass, ghostBtnClass } from './adminUi'

interface FormState {
  provider_id: string
  name: string
  base_url: string
  api_key: string
  priority: number
  weight: number
  max_concurrent: number
  is_enabled: boolean
}

const emptyForm = (providerId: string): FormState => ({
  provider_id: providerId,
  name: '',
  base_url: '',
  api_key: '',
  priority: 100,
  weight: 100,
  max_concurrent: 10,
  is_enabled: true,
})

export default function ChannelsPanel() {
  const showToast = useStore((s) => s.showToast)
  const [channels, setChannels] = useState<Channel[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm(''))
  const [editingId, setEditingId] = useState<string | null>(null)

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? '未知厂商'

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [ch, pv] = await Promise.all([listChannels(), listProviders()])
      setChannels(ch)
      setProviders(pv)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm(providers[0]?.id ?? ''))
    setCreating(true)
  }

  const openEdit = (c: Channel) => {
    setCreating(false)
    setEditingId(c.id)
    setForm({
      provider_id: c.provider_id,
      name: c.name,
      base_url: c.base_url,
      api_key: '',
      priority: c.priority,
      weight: c.weight,
      max_concurrent: c.max_concurrent,
      is_enabled: c.is_enabled,
    })
  }

  const closeForm = () => {
    setCreating(false)
    setEditingId(null)
  }

  const handleCreate = async () => {
    if (!form.provider_id) {
      showToast('请选择厂商', 'error')
      return
    }
    if (!form.name.trim() || !form.base_url.trim()) {
      showToast('请填写名称与 base_url', 'error')
      return
    }
    if (!form.api_key.trim()) {
      showToast('请填写 API Key', 'error')
      return
    }
    const input: ChannelCreateInput = {
      provider_id: form.provider_id,
      name: form.name.trim(),
      base_url: form.base_url.trim(),
      api_key: form.api_key,
      priority: Number(form.priority),
      weight: Number(form.weight),
      max_concurrent: Number(form.max_concurrent),
      is_enabled: form.is_enabled,
    }
    setSubmitting(true)
    try {
      await createChannel(input)
      closeForm()
      await load()
      showToast('渠道已创建', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '创建失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = async (id: string) => {
    if (!form.name.trim() || !form.base_url.trim()) {
      showToast('请填写名称与 base_url', 'error')
      return
    }
    const input: ChannelUpdateInput = {
      name: form.name.trim(),
      base_url: form.base_url.trim(),
      priority: Number(form.priority),
      weight: Number(form.weight),
      max_concurrent: Number(form.max_concurrent),
      is_enabled: form.is_enabled,
    }
    if (form.api_key.trim()) input.api_key = form.api_key
    setSubmitting(true)
    try {
      await updateChannel(id, input)
      closeForm()
      await load()
      showToast('渠道已更新', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '更新失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (c: Channel) => {
    if (!window.confirm(`确定删除渠道「${c.name}」？`)) return
    try {
      await deleteChannel(c.id)
      await load()
      showToast('渠道已删除', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '删除失败', 'error')
    }
  }

  const isEditing = editingId !== null
  const formVisible = creating || isEditing

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-gray-800 dark:text-gray-200">渠道</h2>
        {!formVisible && (
          <button type="button" className={primaryBtnClass} onClick={openCreate} disabled={providers.length === 0}>
            新建渠道
          </button>
        )}
      </div>

      {!formVisible && providers.length === 0 && !loading && (
        <div className="text-xs text-gray-500 dark:text-gray-400">请先创建厂商，才能新建渠道。</div>
      )}

      {formVisible && (
        <div className={cardClass}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="厂商">
              {isEditing ? (
                <input className={inputClass} value={providerName(form.provider_id)} readOnly disabled />
              ) : (
                <Select
                  value={form.provider_id}
                  onChange={(v) => setForm((f) => ({ ...f, provider_id: String(v) }))}
                  options={providers.map((p) => ({ label: p.name, value: p.id }))}
                  className={selectClass}
                />
              )}
            </Field>
            <Field label="名称">
              <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="base_url">
              <input className={inputClass} value={form.base_url} onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))} placeholder="https://api.example.com/v1" />
            </Field>
            <Field label="API Key">
              <input
                type="password"
                className={inputClass}
                value={form.api_key}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                placeholder={isEditing ? '留空则不修改' : ''}
              />
            </Field>
            <Field label="优先级 priority">
              <input type="number" className={inputClass} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))} />
            </Field>
            <Field label="权重 weight">
              <input type="number" className={inputClass} value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: Number(e.target.value) }))} />
            </Field>
            <Field label="最大并发 max_concurrent">
              <input type="number" className={inputClass} value={form.max_concurrent} onChange={(e) => setForm((f) => ({ ...f, max_concurrent: Number(e.target.value) }))} />
            </Field>
            <Field label="状态">
              <Select
                value={form.is_enabled ? 'on' : 'off'}
                onChange={(v) => setForm((f) => ({ ...f, is_enabled: v === 'on' }))}
                options={[
                  { label: '启用', value: 'on' },
                  { label: '停用', value: 'off' },
                ]}
                className={selectClass}
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={primaryBtnClass}
              disabled={submitting}
              onClick={() => (isEditing ? void handleUpdate(editingId!) : void handleCreate())}
            >
              {submitting ? '提交中…' : isEditing ? '保存' : '创建'}
            </button>
            <button type="button" className={ghostBtnClass} onClick={closeForm}>
              取消
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">加载中…</div>
      ) : error ? (
        <div className="text-sm text-red-500">{error}</div>
      ) : channels.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">暂无数据</div>
      ) : (
        <div className="space-y-2">
          {channels.map((c) => (
            <div key={c.id} className={`${cardClass} flex items-center justify-between gap-3`}>
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-gray-800 dark:text-gray-200">{c.name}</span>
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{providerName(c.provider_id)}</span>
                  <span className={`shrink-0 text-xs ${c.is_enabled ? 'text-green-500' : 'text-gray-400 dark:text-gray-500'}`}>
                    {c.is_enabled ? '启用' : '停用'}
                  </span>
                </div>
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">{c.base_url}</div>
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                  Key：{c.has_api_key ? c.api_key_preview : '未配置'} · 优先级 {c.priority} · 权重 {c.weight} · 并发 {c.max_concurrent}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className={ghostBtnClass} onClick={() => openEdit(c)}>
                  编辑
                </button>
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  onClick={() => void handleDelete(c)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
