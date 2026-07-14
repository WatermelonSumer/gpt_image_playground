import { useEffect, useState, useMemo, useRef } from 'react'
import { useStore, getCachedImage, ensureImageCached, reuseConfig, editOutputs, removeTask, retryTask } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useTooltip } from '../hooks/useTooltip'
import { formatImageRatio } from '../lib/size'
import { ActualValueBadge, DetailParamValue } from '../lib/paramDisplay'
import { copyImageSourceToClipboard, copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { downloadImageEntriesAsZip, downloadImageIds, getImageZipEntries } from '../lib/downloadImages'
import { isAgentTaskPromptPending } from '../lib/taskPromptDisplay'
import { replaceImageMentionsForApi } from '../lib/promptImageMentions'
import { CloseIcon, CopyIcon, DownloadIcon, EditIcon, TrashIcon } from './icons'

import ViewportTooltip from './ViewportTooltip'

export default function DetailModal() {
  const tasks = useStore((s) => s.tasks)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const settings = useStore((s) => s.settings)
  const streamPreviewSrc = useStore((s) => detailTaskId ? s.streamPreviews[detailTaskId] || '' : '')
  const streamPreviewSlots = useStore((s) => detailTaskId ? s.streamPreviewSlots[detailTaskId] : undefined)

  const [imageIndex, setImageIndex] = useState(0)
  const [imageSrcs, setImageSrcs] = useState<Record<string, string>>({})
  const [outputPreviewSrcs, setOutputPreviewSrcs] = useState<Record<string, string>>({})
  const [imageRatios, setImageRatios] = useState<Record<string, string>>({})
  const [imageSizes, setImageSizes] = useState<Record<string, string>>({})
  const [maskPreviewSrc, setMaskPreviewSrc] = useState('')
  const [now, setNow] = useState(Date.now())
  const [streamPreviewLoaded, setStreamPreviewLoaded] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const copyErrorTooltip = useTooltip()
  const downloadPartialImagesTooltip = useTooltip()
  const retryTooltip = useTooltip()
  const downloadImageTooltip = useTooltip()
  const downloadOriginalImageTooltip = useTooltip()
  const downloadAllTooltip = useTooltip()

  const task = useMemo(
    () => tasks.find((t) => t.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  )
  const streamPreviewItems = useMemo(() => {
    const slotEntries = streamPreviewSlots
      ? Object.entries(streamPreviewSlots)
          .filter(([, src]) => Boolean(src))
          .sort(([a], [b]) => Number(a) - Number(b))
      : []
    const count = Math.max(
      task?.status === 'running' ? task.params.n : 0,
      slotEntries.length ? Math.max(...slotEntries.map(([key]) => Number(key) + 1)) : 0,
      streamPreviewSrc ? 1 : 0,
    )
    const byIndex = new Map(slotEntries.map(([key, src]) => [Number(key), src]))

    return Array.from({ length: count }, (_, index) => ({
      key: String(index),
      src: byIndex.get(index) ?? (index === 0 ? streamPreviewSrc : ''),
    }))
  }, [task?.params.n, task?.status, streamPreviewSlots, streamPreviewSrc])
  const activeStreamPreviewSrc = streamPreviewItems[imageIndex]?.src || ''

  useEffect(() => {
    setStreamPreviewLoaded(false)
  }, [activeStreamPreviewSrc, detailTaskId, imageIndex])

  useEffect(() => {
    const count = task?.status === 'running'
      ? streamPreviewItems.length
      : task
      ? (task.outputErrors?.length ? Math.max(task.params.n, task.outputImages.length + task.outputErrors.length) : task.outputImages.length)
      : 0
    if (count > 0 && imageIndex >= count) setImageIndex(count - 1)
  }, [imageIndex, streamPreviewItems.length, task, task?.status])

  useCloseOnEscape(Boolean(task), () => setDetailTaskId(null))
  usePreventBackgroundScroll(Boolean(task), [modalRef])

  // Reset index when task changes
  useEffect(() => {
    setImageIndex(0)
  }, [detailTaskId])

  useEffect(() => {
    if (task?.status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => window.clearInterval(id)
  }, [task?.status])

  // 加载所有相关图片
  useEffect(() => {
    if (!task) {
      setImageSrcs({})
      setOutputPreviewSrcs({})
      setImageRatios({})
      setImageSizes({})
      return
    }

    let cancelled = false
    const ids = [...new Set([
      ...(task.inputImageIds || []),
      ...(task.maskImageId ? [task.maskImageId] : []),
    ])]
    const initial: Record<string, string> = {}
    for (const id of ids) {
      const cached = getCachedImage(id)
      if (cached) initial[id] = cached
    }
    setImageSrcs(initial)
    for (const id of ids) {
      if (initial[id]) continue
      ensureImageCached(id).then((url) => {
        if (!cancelled && url) setImageSrcs((prev) => ({ ...prev, [id]: url }))
      })
    }

    return () => {
      cancelled = true
    }
  }, [task])

  const maskTargetId = task?.maskTargetImageId || null
  const maskTargetSrc = maskTargetId ? imageSrcs[maskTargetId] || '' : ''
  const maskSrc = task?.maskImageId ? imageSrcs[task.maskImageId] || '' : ''
  const allInputImageIds = task?.inputImageIds ?? []
  const outputSlots = useMemo(() => {
    if (!task) return []
    const outputErrors = task.outputErrors ?? []
    if (outputErrors.length === 0) {
      return task.outputImages.map((imageId, outputImageIndex) => ({
        requestIndex: outputImageIndex,
        outputImageIndex,
        imageId,
        error: '',
      }))
    }

    const errorsByIndex = new Map(outputErrors.map((item) => [item.requestIndex, item.error]))
    const requestedCount = Math.max(task.params.n, task.outputImages.length + outputErrors.length)
    let outputImageIndex = 0
    return Array.from({ length: requestedCount }, (_, requestIndex) => {
      const error = errorsByIndex.get(requestIndex)
      if (error) return { requestIndex, outputImageIndex: -1, imageId: '', error }
      const imageId = task.outputImages[outputImageIndex] ?? ''
      const slot = { requestIndex, outputImageIndex, imageId, error: '' }
      outputImageIndex += 1
      return slot
    })
  }, [task])
  const currentOutputSlot = outputSlots[imageIndex]
  const currentOutputImageId = currentOutputSlot?.imageId || ''
  const currentOutputImageIndex = currentOutputSlot?.outputImageIndex ?? -1
  const currentOutputError = currentOutputSlot?.error || ''
  const currentOriginalOutputImageId = currentOutputImageIndex >= 0 ? task?.transparentOriginalImages?.[currentOutputImageIndex] || '' : ''
  const currentOutputPreviewSrc = currentOutputImageId ? outputPreviewSrcs[currentOutputImageId] || '' : ''

  useEffect(() => {
    const outputImageIds = task?.outputImages ?? []
    if (outputImageIds.length === 0) {
      setOutputPreviewSrcs({})
      return
    }

    let cancelled = false
    const setOutputImage = (imageId: string, dataUrl: string) => {
      if (!cancelled) setOutputPreviewSrcs((prev) => ({ ...prev, [imageId]: dataUrl }))
    }

    for (const imageId of outputImageIds) {
      const cached = getCachedImage(imageId)
      if (cached) {
        setOutputImage(imageId, cached)
      } else {
        ensureImageCached(imageId)
          .then((dataUrl) => {
            if (dataUrl) setOutputImage(imageId, dataUrl)
          })
          .catch(() => {})
      }
    }

    return () => {
      cancelled = true
    }
  }, [task?.outputImages])

  useEffect(() => {
    let cancelled = false
    setMaskPreviewSrc('')
    if (!maskTargetSrc || !maskSrc) return

    createMaskPreviewDataUrl(maskTargetSrc, maskSrc)
      .then((url) => {
        if (!cancelled) setMaskPreviewSrc(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewSrc('')
      })

    return () => {
      cancelled = true
    }
  }, [maskTargetSrc, maskSrc])

  if (!task) return null

  const isAgentTask = false
  const showPendingPrompt = isAgentTaskPromptPending(task)
  const isAgentEditTool = false
  const showReferenceSection = allInputImageIds.length > 0 || isAgentEditTool

  const outputLen = outputSlots.length
  const currentImageRatio = currentOutputImageId ? imageRatios[currentOutputImageId] : ''
  const currentImageSize = currentOutputImageId ? imageSizes[currentOutputImageId] : ''
  const baseActualParams = currentOutputImageId
    ? task.actualParamsByImage?.[currentOutputImageId] ?? task.actualParams
    : task.actualParams
  const currentActualParams = (baseActualParams?.size || !currentImageSize)
    ? baseActualParams
    : { ...(baseActualParams ?? {}), size: currentImageSize.replace('×', 'x') }
  const currentRevisedPrompt = currentOutputImageId ? task.revisedPromptByImage?.[currentOutputImageId]?.trim() : ''
  // 将 @图N 等 mention 标记和透明背景追加提示词都按实际请求内容比较，
  // 避免仅由本地请求预处理导致的不一致被当作“API 改写”。
  const requestPrompt = task.transparentOutput && task.transparentPrompt
    ? task.transparentPrompt
    : task.prompt
  const promptSentToApi = replaceImageMentionsForApi(requestPrompt, task.inputImageIds.length).trim()
  const showRevisedPrompt = Boolean(currentRevisedPrompt && currentRevisedPrompt !== promptSentToApi)
  const taskModel = task.apiModel || '未知'
  const showSourceInfo = Boolean(task.apiModel)
  const isFalReconnecting = false
  const streamPreviewLen = streamPreviewItems.length
  const currentStreamPreviewSrc = activeStreamPreviewSrc
  const streamPartialImageIds = task.streamPartialImageIds ?? []
  const isPngOutput = task.params.output_format === 'png'
  const transparentOutputText = task.transparentOutput || task.params.transparent_output ? 'true' : 'false'
  const currentTransparentOutputFailed = Boolean(currentOutputImageId && task.transparentOutput && task.transparentOriginalImages?.[currentOutputImageIndex] === '')
  const outputCompressionText = task.params.output_compression == null ? '未设置' : String(task.params.output_compression)

  const formatTime = (ts: number | null) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString('zh-CN')
  }

  const formatDuration = () => {
    if (task.status === 'running') {
      const seconds = Math.max(0, Math.floor((now - task.createdAt) / 1000))
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
      const ss = String(seconds % 60).padStart(2, '0')
      return `${mm}:${ss}`
    }
    if (task.elapsed == null) return null
    const seconds = Math.floor(task.elapsed / 1000)
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const handleReuse = () => {
    reuseConfig(task)
    setDetailTaskId(null)
  }

  const handleEdit = () => {
    editOutputs(task)
    setDetailTaskId(null)
  }

  const handleDelete = () => {
    setDetailTaskId(null)
    setConfirmDialog({
      title: '删除任务',
      message: '确定要删除这个任务吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  const handleToggleFavorite = () => {
    openFavoritePicker([task.id])
  }

  const handleCopyError = async () => {
    const errorText = task.error || '生成失败'
    try {
      await copyTextToClipboard(errorText)
      showToast('完整报错已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制报错失败', err), 'error')
    }
  }

  const handleCopyPrompt = async () => {
    if (!task.prompt) return
    try {
      await copyTextToClipboard(task.prompt)
      showToast('提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制提示词失败', err), 'error')
    }
  }

  const handleCopyInputImage = async () => {
    const imgId = allInputImageIds[0]
    const src = imgId ? imageSrcs[imgId] : ''
    if (!src) return
    try {
      await copyImageSourceToClipboard(src)
      showToast('参考图已复制', 'success')
    } catch (err) {
      console.error(err)
      showToast(getClipboardFailureMessage('复制参考图失败', err), 'error')
    }
  }

  const handleDownloadCurrentOutput = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentOutputImageId || !task) return

    try {
      const result = await downloadImageIds([currentOutputImageId], `task-${task.id}`)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else {
        showToast('下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleDownloadCurrentOriginalOutput = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentOriginalOutputImageId || !task) return

    try {
      const result = await downloadImageIds([currentOriginalOutputImageId], `task-${task.id}-orig`)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else {
        showToast('原图下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleDownloadAllOutputs = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!task?.outputImages?.length) return

    try {
      const fileNameBase = `task-${task.id}`
      const result = settings.zipDownloadRoutes.includes('task-detail-all')
        ? await downloadImageEntriesAsZip(getImageZipEntries(task.outputImages, fileNameBase), fileNameBase)
        : await downloadImageIds(task.outputImages, fileNameBase)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else if (result.failCount > 0) {
        showToast(`部分下载失败：成功 ${result.successCount}，失败 ${result.failCount}`, 'error')
      } else {
        showToast(result.successCount > 1 ? `下载成功：${result.successCount} 张图片` : '下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleDownloadPartialImages = async () => {
    if (!task || !streamPartialImageIds.length) return

    try {
      const fileNameBase = `task-${task.id}-partial`
      const result = settings.zipDownloadRoutes.includes('task-detail-partial')
        ? await downloadImageEntriesAsZip(getImageZipEntries(streamPartialImageIds, fileNameBase), fileNameBase)
        : await downloadImageIds(streamPartialImageIds, fileNameBase)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else if (result.failCount > 0) {
        showToast(`部分下载失败：成功 ${result.successCount}，失败 ${result.failCount}`, 'error')
      } else {
        showToast(`下载成功：${result.successCount} 张中间步骤图`, 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleRetry = () => {
    retryTask(task)
    setDetailTaskId(null)
  }

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => setDetailTaskId(null)}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row z-10 ring-1 ring-black/5 dark:ring-white/10 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-14 items-center justify-end px-4 md:hidden">
          <button
            onClick={() => setDetailTaskId(null)}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400"
            aria-label="关闭"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* 左侧：图片 */}
        <div className="md:w-1/2 w-full h-64 md:h-auto bg-gray-100 dark:bg-black/20 relative flex items-center justify-center flex-shrink-0 min-h-[16rem]">
          {task.status === 'done' && outputLen > 0 && (currentOutputImageId || task.outputImages.length > 0) && (
            <div className="absolute right-3 top-[15px] z-20 flex items-center gap-1.5">
              {currentOutputImageId && (
                <div className="relative group flex">
                  <button
                    type="button"
                    {...downloadImageTooltip.handlers}
                    onClick={(e) => {
                      downloadImageTooltip.handlers.onClick()
                      handleDownloadCurrentOutput(e)
                    }}
                      className="flex items-center justify-center px-1.5 py-0.5 bg-black/50 text-white rounded backdrop-blur-sm hover:bg-black/70 transition focus:outline-none focus:ring-1 focus:ring-white/50"
                    aria-label="下载图片"
                  >
                    <DownloadIcon className="h-4 w-4" />
                  </button>
                  <ViewportTooltip visible={downloadImageTooltip.visible} className="whitespace-nowrap">
                    下载图片
                  </ViewportTooltip>
                </div>
              )}
              {task.outputImages.length > 1 && (
                <div className="relative group flex">
                  <button
                    type="button"
                    {...downloadAllTooltip.handlers}
                    onClick={(e) => {
                      downloadAllTooltip.handlers.onClick()
                      handleDownloadAllOutputs(e)
                    }}
                    className="flex items-center justify-center pl-1.5 pr-2 py-0.5 gap-0.5 bg-black/50 text-white rounded backdrop-blur-sm hover:bg-black/70 transition focus:outline-none focus:ring-1 focus:ring-white/50"
                    aria-label="下载全部"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    <span className="text-[9px] font-bold leading-none mt-[1px]">ALL</span>
                  </button>
                  <ViewportTooltip visible={downloadAllTooltip.visible} className="whitespace-nowrap">
                    下载全部
                  </ViewportTooltip>
                </div>
              )}
            </div>
          )}
          {task.status === 'done' && outputLen > 0 && currentOutputPreviewSrc && (
            <>
              <img
                src={currentOutputPreviewSrc}
                data-image-id={currentOutputImageId}
                className="saveable-image max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] object-contain cursor-pointer"
                onLoad={(e) => {
                  const image = e.currentTarget
                  if (currentOutputImageId && image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setImageRatios((prev) => ({
                      ...prev,
                      [currentOutputImageId]: formatImageRatio(image.naturalWidth, image.naturalHeight),
                    }))
                    setImageSizes((prev) => ({
                      ...prev,
                      [currentOutputImageId]: `${image.naturalWidth}×${image.naturalHeight}`,
                    }))
                  }
                }}
                onClick={() =>
                  setLightboxImageId(currentOutputImageId, task.outputImages)
                }
                alt=""
              />
              <div data-selectable-text className="absolute left-4 top-[15px] flex items-center gap-1.5">
                {currentImageRatio && currentImageSize ? (
                  <>
                    <span className="bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
                      {currentImageRatio}
                    </span>
                    <span className="bg-black/50 text-white/90 text-xs px-2 py-0.5 rounded backdrop-blur-sm font-medium">
                      {currentImageSize}
                    </span>
                  </>
                ) : (
                  formatDuration() && (
                    <span className="flex items-center gap-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {formatDuration()}
                    </span>
                  )
                )}
              </div>
              {outputLen > 1 && (
                <>
                  <button
                    onClick={() =>
                      setImageIndex(
                        (imageIndex - 1 + outputLen) % outputLen,
                      )
                    }
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() =>
                      setImageIndex((imageIndex + 1) % outputLen)
                    }
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                    {imageIndex + 1} / {outputLen}
                  </span>
                </>
              )}
              {currentOriginalOutputImageId && (
                <div className="absolute bottom-4 right-4 z-20 flex">
                  <button
                    type="button"
                    {...downloadOriginalImageTooltip.handlers}
                    onClick={(e) => {
                      downloadOriginalImageTooltip.handlers.onClick()
                      handleDownloadCurrentOriginalOutput(e)
                    }}
                    className="flex items-center justify-center gap-0.5 rounded bg-black/50 py-0.5 pl-1.5 pr-2 text-white backdrop-blur-sm transition hover:bg-black/70 focus:outline-none focus:ring-1 focus:ring-white/50"
                    aria-label="下载原图"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    <span className="text-[9px] font-bold leading-none mt-[1px] uppercase">orig</span>
                  </button>
                  <ViewportTooltip visible={downloadOriginalImageTooltip.visible} className="whitespace-nowrap">
                    下载原图
                  </ViewportTooltip>
                </div>
              )}
            </>
          )}
          {task.status === 'done' && outputLen > 0 && currentOutputError && (
            <div className="w-full max-w-md px-4 text-center">
              <svg className="w-10 h-10 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-red-500">第 {currentOutputSlot.requestIndex + 1} 张生成失败</p>
              <p
                className="mt-2 overflow-hidden whitespace-pre-line text-sm leading-6 text-red-500 break-words"
                style={{
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 8,
                }}
              >
                {currentOutputError}
              </p>
              {outputLen > 1 && (
                <>
                  <button
                    onClick={() => setImageIndex((imageIndex - 1 + outputLen) % outputLen)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setImageIndex((imageIndex + 1) % outputLen)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                    {imageIndex + 1} / {outputLen}
                  </span>
                </>
              )}
            </div>
          )}
          {(task.status === 'running' || isFalReconnecting) && (
            <>
              <div className="absolute left-4 top-4 flex items-center gap-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatDuration()}
              </div>
              {task.status === 'running' && streamPreviewLen > 0 && (
                <>
                  {currentStreamPreviewSrc ? (
                    <img
                      src={currentStreamPreviewSrc}
                      className={`max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] object-contain ${streamPreviewLoaded ? '' : 'hidden'}`}
                      alt=""
                      onLoad={() => setStreamPreviewLoaded(true)}
                      onError={() => setStreamPreviewLoaded(false)}
                    />
                  ) : null}
                  {(!currentStreamPreviewSrc || !streamPreviewLoaded) && (
                    <svg className="w-10 h-10 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {streamPreviewLoaded && (
                    <span className="absolute top-4 right-4 flex items-center gap-1 rounded bg-blue-500 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                      流式预览
                    </span>
                  )}
                  {streamPreviewLen > 1 && (
                    <>
                      <button
                        onClick={() => setImageIndex((imageIndex - 1 + streamPreviewLen) % streamPreviewLen)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setImageIndex((imageIndex + 1) % streamPreviewLen)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                        {imageIndex + 1} / {streamPreviewLen}
                      </span>
                    </>
                  )}
                </>
              )}
              {task.status === 'running' && streamPreviewLen === 0 && (
                <svg className="w-10 h-10 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </>
          )}
          {task.status === 'error' && isFalReconnecting && (
            <div className="w-full max-w-md px-4 text-center">
              <svg className="w-10 h-10 text-yellow-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p className="text-sm font-medium text-yellow-500">重连中</p>
            </div>
          )}
          {task.status === 'error' && !isFalReconnecting && (
            <div className="w-full max-w-md px-4 text-center">
              <svg className="w-10 h-10 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p
                className="overflow-hidden whitespace-pre-line text-sm leading-6 text-red-500 break-words"
                style={{
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 10,
                }}
              >
                {task.error || '生成失败'}
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <div className="relative group">
                  <button
                    type="button"
                    {...copyErrorTooltip.handlers}
                    onClick={() => {
                      copyErrorTooltip.handlers.onClick()
                      handleCopyError()
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-red-200/80 bg-white/80 px-3 py-1.5 text-red-500 transition hover:bg-red-50 dark:border-red-400/20 dark:bg-white/[0.04] dark:hover:bg-red-500/10"
                    aria-label="复制完整报错"
                  >
                    <CopyIcon className="h-4 w-4" />
                  </button>
                  <ViewportTooltip visible={copyErrorTooltip.visible} className="whitespace-nowrap">
                    复制完整报错
                  </ViewportTooltip>
                </div>
                {streamPartialImageIds.length > 0 && (
                  <div className="relative group">
                    <button
                      type="button"
                      {...downloadPartialImagesTooltip.handlers}
                      onClick={() => {
                        downloadPartialImagesTooltip.handlers.onClick()
                        void handleDownloadPartialImages()
                      }}
                      className="inline-flex items-center justify-center rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1.5 text-amber-600 transition hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
                      aria-label="下载中间步骤图"
                    >
                      <DownloadIcon className="h-4 w-4" />
                    </button>
                    <ViewportTooltip visible={downloadPartialImagesTooltip.visible} className="whitespace-nowrap">
                      下载中间步骤图
                    </ViewportTooltip>
                  </div>
                )}
                <div className="relative group">
                  <button
                    type="button"
                    {...retryTooltip.handlers}
                    onClick={() => {
                      retryTooltip.handlers.onClick()
                      handleRetry()
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-blue-200/80 bg-white/80 px-3 py-1.5 text-blue-500 transition hover:bg-blue-50 dark:border-blue-400/20 dark:bg-white/[0.04] dark:hover:bg-blue-500/10"
                    aria-label="重试任务"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <ViewportTooltip visible={retryTooltip.visible} className="whitespace-nowrap">
                    重试任务
                  </ViewportTooltip>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：信息 */}
        <div className="md:w-1/2 w-full p-5 overflow-y-auto overscroll-contain flex flex-col">
          <button
            onClick={() => setDetailTaskId(null)}
            className="absolute top-3 right-3 hidden p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400 z-10 md:block"
            aria-label="关闭"
          >
            <CloseIcon className="w-5 h-5" />
          </button>

          <div data-selectable-text className="flex-1">
            <div className="flex items-center gap-1.5 mb-2">
              <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                输入内容
              </h3>
              {task.prompt && !showPendingPrompt && (
                <button
                  onClick={handleCopyPrompt}
                  className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/[0.06] transition"
                  title="复制提示词"
                >
                  <CopyIcon className="h-4 w-4" />
                </button>
              )}
            </div>
            {showPendingPrompt ? (
              <div className="mb-4 leading-relaxed">
                <p className="text-sm text-gray-700 dark:text-gray-300">正在生成……</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">输入内容将在响应完成时接收</p>
              </div>
            ) : (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap mb-4">
                {task.prompt || '(无提示词)'}
              </p>
            )}
            {showRevisedPrompt && currentRevisedPrompt && (
              <div className="mb-4">
                <ActualValueBadge
                  value={currentRevisedPrompt}
                  className="max-w-full rounded px-2 py-1 text-left text-xs leading-relaxed whitespace-pre-wrap"
                />
              </div>
            )}

            {/* 参考图 */}
            {showReferenceSection && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    参考图
                  </h3>
                  {allInputImageIds.length > 0 && (
                    <button
                      onClick={handleCopyInputImage}
                      className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/[0.06] transition"
                      title="复制参考图"
                    >
                      <CopyIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {allInputImageIds.length > 0 ? (
                  <>
                    <div className="flex gap-2 flex-wrap">
                      {allInputImageIds.map((imgId) => {
                        const isMaskTarget = imgId === maskTargetId
                        const displaySrc = (isMaskTarget && maskPreviewSrc) ? maskPreviewSrc : (imageSrcs[imgId] || '')
                        return (
                          <div key={imgId} className="relative group inline-block">
                            <div
                              className={`relative w-16 h-16 rounded-lg overflow-hidden border cursor-pointer hover:opacity-80 transition ${
                                isMaskTarget ? 'border-blue-500 border-2 shadow-sm' : 'border-gray-200 dark:border-white/[0.08]'
                              }`}
                              onClick={() => setLightboxImageId(imgId, allInputImageIds)}
                            >
                              {displaySrc && (
                                <img
                                  src={displaySrc}
                                  data-image-id={imgId}
                                  className="w-full h-full object-cover"
                                  alt=""
                                />
                              )}
                              {isMaskTarget && (
                                <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
                                  MASK
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {isAgentEditTool && (
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        由模型自主选择，可能包含其他图片
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    由模型自主选择
                  </div>
                )}
              </div>
            )}

            {/* 参数 */}
            <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              参数配置
            </h3>
            {showSourceInfo && (
              <div className="mb-2 min-w-0 overflow-hidden rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
                <span className="text-gray-400 dark:text-gray-500">模型</span>
                <br />
                <div className="mt-0.5 overflow-x-auto hide-scrollbar whitespace-nowrap mask-edge-r pr-2">
                  <span className="font-medium text-gray-700 dark:text-gray-200">{taskModel}</span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs mb-4 min-w-0">
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 min-w-0 overflow-hidden">
                <span className="text-gray-400 dark:text-gray-500">尺寸</span>
                <br />
                <div className="mt-0.5 overflow-x-auto hide-scrollbar whitespace-nowrap mask-edge-r pr-2">
                  <DetailParamValue task={task} paramKey="size" className="font-medium" actualParams={currentActualParams} />
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 min-w-0 overflow-hidden">
                <span className="text-gray-400 dark:text-gray-500">质量</span>
                <br />
                <div className="mt-0.5 overflow-x-auto hide-scrollbar whitespace-nowrap mask-edge-r pr-2">
                  <DetailParamValue task={task} paramKey="quality" className="font-medium" actualParams={currentActualParams} />
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 min-w-0 overflow-hidden">
                <span className="text-gray-400 dark:text-gray-500">格式</span>
                <br />
                <div className="mt-0.5 overflow-x-auto hide-scrollbar whitespace-nowrap mask-edge-r pr-2">
                  <DetailParamValue task={task} paramKey="output_format" className="font-medium" actualParams={currentActualParams} />
                </div>
              </div>
              {isPngOutput ? (
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 min-w-0 overflow-hidden">
                  <span className="text-gray-400 dark:text-gray-500">透明背景</span>
                  <br />
                  <div className="mt-0.5 overflow-x-auto hide-scrollbar whitespace-nowrap mask-edge-r pr-2">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{transparentOutputText}</span>
                    {currentTransparentOutputFailed && (
                      <span className="ml-1.5 rounded bg-red-50 px-1 py-0.5 text-[10px] font-medium uppercase leading-none text-red-600 dark:bg-red-500/10 dark:text-red-400">
                        failed
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 min-w-0 overflow-hidden">
                  <span className="text-gray-400 dark:text-gray-500">压缩率</span>
                  <br />
                  <div className="mt-0.5 overflow-x-auto hide-scrollbar whitespace-nowrap mask-edge-r pr-2">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{outputCompressionText}</span>
                  </div>
                </div>
              )}
              <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 min-w-0 overflow-hidden">
                <span className="text-gray-400 dark:text-gray-500">审核</span>
                <br />
                <div className="mt-0.5 overflow-x-auto hide-scrollbar whitespace-nowrap mask-edge-r pr-2">
                  <DetailParamValue task={task} paramKey="moderation" className="font-medium" actualParams={currentActualParams} />
                </div>
              </div>
              {!isAgentTask && (
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 min-w-0 overflow-hidden">
                  <span className="text-gray-400 dark:text-gray-500">数量</span>
                  <br />
                  <div className="mt-0.5 overflow-x-auto hide-scrollbar whitespace-nowrap mask-edge-r pr-2">
                    <DetailParamValue task={task} paramKey="n" className="font-medium" />
                  </div>
                </div>
              )}
            </div>

            {/* 时间 */}
            <div className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              <span>创建于 {formatTime(task.createdAt)}</span>
              {formatDuration() && <span> · 耗时 {formatDuration()}</span>}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="grid grid-cols-4 sm:flex gap-2 pt-4 border-t border-gray-100 dark:border-white/[0.08]">
            <button
              onClick={handleReuse}
              className="col-span-2 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition text-sm font-medium whitespace-nowrap"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              复用配置
            </button>
            <button
              onClick={handleEdit}
              disabled={!outputLen}
              className="col-span-2 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium whitespace-nowrap"
            >
              <EditIcon className="w-4 h-4 flex-shrink-0" />
              编辑输出
            </button>
            <button
              onClick={handleDelete}
              className="col-span-3 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition text-sm font-medium whitespace-nowrap"
            >
              <TrashIcon className="w-4 h-4 flex-shrink-0" />
              删除任务
            </button>
            <button
              onClick={handleToggleFavorite}
              className={`col-span-1 sm:flex-none sm:w-11 w-full flex items-center justify-center rounded-xl transition ${
                task.isFavorite
                  ? 'bg-yellow-50 text-yellow-500 hover:bg-yellow-100 dark:bg-yellow-500/10 dark:hover:bg-yellow-500/20'
                  : 'bg-gray-50 text-gray-400 hover:bg-yellow-50 hover:text-yellow-500 dark:bg-white/[0.04] dark:hover:bg-yellow-500/10'
              }`}
              title={task.isFavorite ? '编辑收藏夹' : '收藏任务'}
            >
              <svg className="w-5 h-5" fill={task.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
