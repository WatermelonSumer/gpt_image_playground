import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { ApiError } from '../../lib/apiClient'
import Select from '../Select'
import {
  listPlatformModels,
  listProviders,
  createPlatformModel,
  updatePlatformModel,
  deletePlatformModel,
  type AdminPlatformModel,
  type Provider,
  type ModelCreateInput,
  type ModelUpdateInput,
} from '../../lib/adminApi'
import { Field, Checkbox, cardClass, inputClass, selectClass, primaryBtnClass, ghostBtnClass } from './adminUi'

interface FormState {
  provider_id: string
  platform_model_id: string
  display_name: string
  upstream_model_id: string
  unit_price: number
  max_n: number
  supports_edit: boolean
  supports_size: boolean
  supports_quality: boolean
  supports_n: boolean
  is_enabled: boolean
}

const emptyForm = (providerId: string): FormState => ({
  provider_id: providerId,
  platform_model_id: '',
  display_name: '',
  upstream_model_id: '',
  unit_price: 0,
  max_n: 4,
  supports_edit: false,
  supports_size: true,
  supports_quality: true,
  supports_n: true,
  is_enabled: true,
})

export default function ModelsPanel() {
  const showToast = useStore((s) => s.showToast)
  const [models, setModels] = useState<AdminPlatformModel[]>([])
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
      const [ml, pv] = await Promise.all([listPlatformModels(), listProviders()])
      setModels(ml)
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

  const openEdit = (m: AdminPlatformModel) => {
    setCreating(false)
    setEditingId(m.id)
    setForm({
      provider_id: m.provider_id,
      platform_model_id: m.platform_model_id,
      display_name: m.display_name,
      upstream_model_id: m.upstream_model_id,
      unit_price: m.unit_price,
      max_n: m.max_n,
      supports_edit: m.supports_edit,
      supports_size: m.supports_size,
      supports_quality: m.supports_quality,
      supports_n: m.supports_n,
      is_enabled: m.is_enabled,
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
    if (!form.platform_model_id.trim() || !form.display_name.trim() || !form.upstream_model_id.trim()) {
      showToast('请填写模型ID、显示名与上游模型ID', 'error')
      return
    }
    const input: ModelCreateInput = {
      provider_id: form.provider_id,
      platform_model_id: form.platform_model_id.trim(),
      display_name: form.display_name.trim(),
      upstream_model_id: form.upstream_model_id.trim(),
      unit_price: Number(form.unit_price),
      max_n: Number(form.max_n),
      supports_edit: form.supports_edit,
      supports_size: form.supports_size,
      supports_quality: form.supports_quality,
      supports_n: form.supports_n,
      is_enabled: form.is_enabled,
    }
    setSubmitting(true)
    try {
      await createPlatformModel(input)
      closeForm()
      await load()
      showToast('模型已创建', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '创建失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = async (id: string) => {
    if (!form.display_name.trim() || !form.upstream_model_id.trim()) {
      showToast('请填写显示名与上游模型ID', 'error')
      return
    }
    const input: ModelUpdateInput = {
      display_name: form.display_name.trim(),
      upstream_model_id: form.upstream_model_id.trim(),
      unit_price: Number(form.unit_price),
      max_n: Number(form.max_n),
      supports_edit: form.supports_edit,
      supports_size: form.supports_size,
      supports_quality: form.supports_quality,
      supports_n: form.supports_n,
      is_enabled: form.is_enabled,
    }
    setSubmitting(true)
    try {
      await updatePlatformModel(id, input)
      closeForm()
      await load()
      showToast('模型已更新', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '更新失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (m: AdminPlatformModel) => {
    if (!window.confirm(`确定删除模型「${m.display_name}」？`)) return
    try {
      await deletePlatformModel(m.id)
      await load()
      showToast('模型已删除', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '删除失败', 'error')
    }
  }

  const isEditing = editingId !== null
  const formVisible = creating || isEditing

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-gray-800 dark:text-gray-200">模型池</h2>
        {!formVisible && (
          <button type="button" className={primaryBtnClass} onClick={openCreate} disabled={providers.length === 0}>
            新建模型
          </button>
        )}
      </div>

      {!formVisible && providers.length === 0 && !loading && (
        <div className="text-xs text-gray-500 dark:text-gray-400">请先创建厂商，才能新建模型。</div>
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
            <Field label="平台模型ID（对用户暴露的ID）">
              {isEditing ? (
                <input className={inputClass} value={form.platform_model_id} readOnly disabled />
              ) : (
                <input className={inputClass} value={form.platform_model_id} onChange={(e) => setForm((f) => ({ ...f, platform_model_id: e.target.value }))} />
              )}
            </Field>
            <Field label="显示名">
              <input className={inputClass} value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
            </Field>
            <Field label="上游模型ID">
              <input className={inputClass} value={form.upstream_model_id} onChange={(e) => setForm((f) => ({ ...f, upstream_model_id: e.target.value }))} />
            </Field>
            <Field label="单价(分，100=1额度)">
              <input type="number" className={inputClass} value={form.unit_price} onChange={(e) => setForm((f) => ({ ...f, unit_price: Number(e.target.value) }))} />
            </Field>
            <Field label="max_n">
              <input type="number" className={inputClass} value={form.max_n} onChange={(e) => setForm((f) => ({ ...f, max_n: Number(e.target.value) }))} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox label="支持编辑 (edit)" checked={form.supports_edit} onChange={(v) => setForm((f) => ({ ...f, supports_edit: v }))} />
            <Checkbox label="支持尺寸 (size)" checked={form.supports_size} onChange={(v) => setForm((f) => ({ ...f, supports_size: v }))} />
            <Checkbox label="支持质量 (quality)" checked={form.supports_quality} onChange={(v) => setForm((f) => ({ ...f, supports_quality: v }))} />
            <Checkbox label="支持多图 (n)" checked={form.supports_n} onChange={(v) => setForm((f) => ({ ...f, supports_n: v }))} />
            <Checkbox label="启用" checked={form.is_enabled} onChange={(v) => setForm((f) => ({ ...f, is_enabled: v }))} />
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
      ) : models.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">暂无数据</div>
      ) : (
        <div className="space-y-2">
          {models.map((m) => (
            <div key={m.id} className={`${cardClass} flex items-center justify-between gap-3`}>
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-gray-800 dark:text-gray-200">{m.display_name}</span>
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{providerName(m.provider_id)}</span>
                  <span className={`shrink-0 text-xs ${m.is_enabled ? 'text-green-500' : 'text-gray-400 dark:text-gray-500'}`}>
                    {m.is_enabled ? '启用' : '停用'}
                  </span>
                </div>
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {m.platform_model_id} → {m.upstream_model_id}
                </div>
                <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {(m.unit_price / 100).toFixed(2)} 额度/张 · max_n {m.max_n}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className={ghostBtnClass} onClick={() => openEdit(m)}>
                  编辑
                </button>
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  onClick={() => void handleDelete(m)}
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
