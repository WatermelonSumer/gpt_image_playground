import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { normalizeImageSize } from './size'

export const DEFAULT_OUTPUT_IMAGE_LIMIT = 10

export function getOutputImageLimitForSettings(_settings: AppSettings) {
  // Provider abstraction removed — return platform default
  return DEFAULT_OUTPUT_IMAGE_LIMIT
}

export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
): TaskParams {
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const nextParams: TaskParams = {
    ...params,
    size: normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    n: Math.min(outputImageLimit, Math.max(1, params.n || DEFAULT_PARAMS.n)),
  }

  if (nextParams.output_format === 'png') {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  return nextParams
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
