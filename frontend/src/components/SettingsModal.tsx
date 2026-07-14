import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, exportData, importData, clearData, type SettingsTab } from '../store'
import { requestBrowserNotificationPermission, type BrowserNotificationPermissionResult } from '../lib/browserNotification'
import { type AppSettings, type ZipDownloadRoute } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Checkbox } from './Checkbox'
import { CloseIcon, TrashIcon, ExportIcon, ImportIcon } from './icons'
import GeneralSettingsTab from './settings/GeneralSettingsTab'

const ZIP_DOWNLOAD_ROUTE_OPTIONS: Array<{ route: ZipDownloadRoute; label: string; description: string }> = [
  { route: 'task-selection', label: '任务列表 > 多选', description: '主页或收藏夹详情中框选、Ctrl/⌘ 点选或移动端滑动选中任务后的"下载选中"。' },
  { route: 'favorite-collection-selection', label: '收藏夹列表 > 多选', description: '收藏夹概览页选中一个或多个收藏夹后的"下载选中"。' },
  { route: 'image-context-menu-all', label: '图片右键菜单 > 下载全部', description: '右键图片时下载同一组输出图片。' },
  { route: 'task-detail-all', label: '任务详情 > 下载全部', description: '任务详情弹窗中下载当前任务的所有输出图。' },
  { route: 'task-detail-partial', label: '任务详情 > 下载中间步骤图', description: '任务详情弹窗中下载流式生成保留的中间步骤图。' },
]

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const settingsTabRequest = useStore((s) => s.settingsTabRequest)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const importInputRef = useRef<HTMLInputElement>(null)
  const settingsScrollBoundaryRef = useRef<HTMLDivElement>(null)
  const zipDownloadRouteScrollBoundaryRef = useRef<HTMLDivElement>(null)

  const [draft, setDraft] = useState<AppSettings>(settings)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [showZipDownloadRouteManager, setShowZipDownloadRouteManager] = useState(false)
  const [exportTasks, setExportTasks] = useState(true)
  const [importTasks, setImportTasks] = useState(true)
  const [clearTasks, setClearTasks] = useState(true)
  const [isExportingData, setIsExportingData] = useState(false)
  const [isImportingData, setIsImportingData] = useState(false)

  const enabledZipDownloadRouteCount = ZIP_DOWNLOAD_ROUTE_OPTIONS
    .filter((option) => draft.zipDownloadRoutes.includes(option.route))
    .length

  const zipDownloadRouteSummary = enabledZipDownloadRouteCount
    ? `已开启 ${enabledZipDownloadRouteCount} 项使用压缩包进行批量下载的途径`
    : '未开启任何使用压缩包进行批量下载的途径'

  useEffect(() => {
    if (showSettings) setDraft(settings)
  }, [showSettings, settings])

  useEffect(() => {
    if (showSettings && settingsTabRequest) setActiveTab(settingsTabRequest)
  }, [settingsTabRequest, showSettings])

  useCloseOnEscape(showSettings, handleClose)
  usePreventBackgroundScroll(
    showSettings,
    showZipDownloadRouteManager ? zipDownloadRouteScrollBoundaryRef : settingsScrollBoundaryRef,
  )

  if (!showSettings) return null

  function commitSettings(nextDraft: AppSettings) {
    setDraft(nextDraft)
    setSettings(nextDraft)
  }

  function handleClose() {
    if (showZipDownloadRouteManager) {
      setShowZipDownloadRouteManager(false)
      return
    }
    setShowSettings(false)
  }

  const setZipDownloadRouteEnabled = (route: ZipDownloadRoute, enabled: boolean) => {
    const nextRoutes = enabled
      ? Array.from(new Set([...draft.zipDownloadRoutes, route]))
      : draft.zipDownloadRoutes.filter((item) => item !== route)
    commitSettings({ ...draft, zipDownloadRoutes: nextRoutes })
  }

  const showNotificationPermissionMessage = (result: BrowserNotificationPermissionResult) => {
    if (!result.ok && result.reason === 'denied') {
      showToast('通知权限已被拒绝，请在浏览器设置中手动允许', 'error')
    } else {
      showToast('没有开启系统通知', 'info')
    }
  }

  const toggleTaskCompletionNotification = async () => {
    if (draft.taskCompletionNotification) {
      commitSettings({ ...draft, taskCompletionNotification: false })
      return
    }
    const result = await requestBrowserNotificationPermission()
    if (result.ok) {
      commitSettings({ ...draft, taskCompletionNotification: true })
      showToast('任务完成通知已开启', 'success')
    } else {
      showNotificationPermissionMessage(result)
    }
  }

  const handleExport = async () => {
    setIsExportingData(true)
    try {
      await exportData({ exportTasks })
    } finally {
      setIsExportingData(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setIsImportingData(true)
      try {
        await importData(file, { importTasks })
        setDraft(useStore.getState().settings)
      } finally {
        setIsImportingData(false)
      }
    }
    e.target.value = ''
  }

  const handleClearAllData = async () => {
    await clearData({ clearConfig: false, clearTasks })
    setDraft(useStore.getState().settings)
  }

  return (
    <div data-no-drag-select className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleClose}
      />
      <div
        ref={settingsScrollBoundaryRef}
        className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 flex h-[85vh] sm:h-[600px] flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 p-5 border-b border-gray-100 dark:border-white/[0.08]">
          <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 dark:text-gray-500 font-mono select-none">v{__APP_VERSION__}</span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* Sidebar */}
          <div className="w-full sm:w-48 shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-gray-100 dark:border-white/[0.08] bg-gray-50/50 dark:bg-white/[0.02]">
            <nav className="flex-1 overflow-x-auto sm:overflow-y-auto custom-scrollbar p-3 space-x-1 sm:space-x-0 sm:space-y-1 flex sm:flex-col">
              <button
                onClick={() => setActiveTab('general')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'general' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                </svg>
                习惯配置
              </button>
              <button
                onClick={() => setActiveTab('data')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'data' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
                数据管理
              </button>
              <button
                onClick={() => setActiveTab('about')}
                className={`whitespace-nowrap flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-xl transition-colors ${activeTab === 'about' ? 'bg-white dark:bg-white/[0.08] shadow-sm text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-white/[0.04]'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                关于
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-transparent relative overflow-hidden">
            <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-5 sm:p-6">
              {activeTab === 'general' && (
                <GeneralSettingsTab
                  draft={draft}
                  zipDownloadRouteSummary={zipDownloadRouteSummary}
                  commitSettings={commitSettings}
                  onOpenZipDownloadRouteManager={() => setShowZipDownloadRouteManager(true)}
                  toggleTaskCompletionNotification={toggleTaskCompletionNotification}
                />
              )}

              {activeTab === 'data' && (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-200/60 dark:bg-white/[0.02] dark:border-white/[0.05] flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                      账户、额度和计费记录保存在服务器。画廊图片和任务历史首版保存在浏览器本地，清除本地数据不影响账户和充值记录。
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <ExportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                      <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导出本地数据</h4>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <Checkbox checked={exportTasks} onChange={setExportTasks} label="任务和图片" />
                    </div>
                    <button
                      onClick={handleExport}
                      disabled={!exportTasks || isExportingData}
                      className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] flex items-center justify-center gap-2"
                    >
                      {isExportingData ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          导出中...
                        </>
                      ) : '导出所选数据'}
                    </button>
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <ImportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                      <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导入本地数据</h4>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <Checkbox checked={importTasks} onChange={setImportTasks} label="任务和图片" />
                    </div>
                    <button
                      onClick={() => importInputRef.current?.click()}
                      disabled={!importTasks || isImportingData}
                      className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] flex items-center justify-center gap-2"
                    >
                      {isImportingData ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          导入中...
                        </>
                      ) : '从 ZIP 导入'}
                    </button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".zip"
                      className="hidden"
                      onChange={handleImport}
                    />
                  </div>

                  <div className="rounded-2xl border border-red-100/50 bg-red-50/30 p-4 dark:border-red-500/10 dark:bg-red-500/5 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <TrashIcon className="w-4 h-4 text-red-500/90 dark:text-red-400" />
                      <h4 className="text-sm font-bold text-red-500/90 dark:text-red-400">清除本地数据</h4>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <Checkbox checked={clearTasks} onChange={setClearTasks} label="任务和图片" tone="danger" />
                    </div>
                    <button
                      onClick={() => setConfirmDialog({
                        title: '清空本地数据',
                        message: '确定清空所选的本地数据？此操作不可恢复。',
                        action: () => handleClearAllData(),
                      })}
                      disabled={!clearTasks}
                      className="w-full rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-2.5 text-sm font-medium text-red-500 transition-all hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-50 dark:border-red-500/15 dark:bg-red-500/5 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:border-red-500/30 dark:hover:text-red-300"
                    >
                      清空所选数据
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'about' && (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center pb-8 px-6">
                  <img src="./pwa-icon.svg" alt="" className="mb-5 h-[88px] w-[88px]" />
                  <h4 className="text-[17px] font-bold text-gray-800 dark:text-gray-100">像素引擎</h4>
                  <p className="mt-1.5 text-[13px] text-gray-500 dark:text-gray-400">PixelEngine</p>
                  <p className="mt-8 max-w-[360px] text-center text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                    统一图片生成、模型调用与额度管理平台
                  </p>
                  <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">版本 {__APP_VERSION__}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showZipDownloadRouteManager && createPortal(
        <div
          data-no-drag-select
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          onClick={() => setShowZipDownloadRouteManager(false)}
        >
          <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
          <div
            className="relative z-10 w-full max-w-md rounded-3xl bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] ring-1 ring-black/5 dark:ring-white/10 animate-confirm-in flex flex-col max-h-[85vh] sm:max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 p-6 pb-2">
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">使用压缩包进行批量下载</h3>
                <button
                  type="button"
                  onClick={() => setShowZipDownloadRouteManager(false)}
                  className="shrink-0 rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                  aria-label="关闭"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              </div>
              <div data-selectable-text className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                开启后，在对应途径进行批量下载时会将结果下载为一个 ZIP，而不是多个图片文件。
              </div>
            </div>

            <div ref={zipDownloadRouteScrollBoundaryRef} className="flex-1 overflow-y-auto px-6 space-y-3 custom-scrollbar min-h-0 py-2">
              {ZIP_DOWNLOAD_ROUTE_OPTIONS.map((option) => {
                const isChecked = draft.zipDownloadRoutes.includes(option.route)
                return (
                  <div
                    key={option.route}
                    role="checkbox"
                    aria-checked={isChecked}
                    tabIndex={0}
                    onClick={() => setZipDownloadRouteEnabled(option.route, !isChecked)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setZipDownloadRouteEnabled(option.route, !isChecked)
                    }}
                    className={`cursor-pointer rounded-2xl border p-3.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${isChecked ? 'border-blue-500/30 bg-blue-50/50 dark:border-blue-400/30 dark:bg-blue-500/[0.05]' : 'border-gray-100 bg-gray-50/70 hover:bg-gray-100/70 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.05]'}`}
                  >
                    <div onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={isChecked}
                        onChange={(checked) => setZipDownloadRouteEnabled(option.route, checked)}
                        label={<span className="text-sm font-medium text-gray-700 dark:text-gray-200">{option.label}</span>}
                      />
                    </div>
                    <div data-selectable-text className="mt-1.5 pl-6 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                      {option.description}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="shrink-0 p-6 pt-4">
              <button
                type="button"
                onClick={() => setShowZipDownloadRouteManager(false)}
                className="w-full rounded-lg bg-blue-500 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
              >
                完成
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
