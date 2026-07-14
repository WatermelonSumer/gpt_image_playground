import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { getOutputImageLimitForSettings, normalizeParamsForSettings, DEFAULT_OUTPUT_IMAGE_LIMIT } from './paramCompatibility'

const DEFAULT_SETTINGS_STUB = {} as Parameters<typeof getOutputImageLimitForSettings>[0]

describe('parameter compatibility', () => {
  it('returns default output image limit', () => {
    expect(getOutputImageLimitForSettings(DEFAULT_SETTINGS_STUB)).toBe(DEFAULT_OUTPUT_IMAGE_LIMIT)
  })

  it('clamps n to outputImageLimit', () => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 99 }, DEFAULT_SETTINGS_STUB).n).toBe(DEFAULT_OUTPUT_IMAGE_LIMIT)
  })

  it('clamps n to minimum of 1', () => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 0 }, DEFAULT_SETTINGS_STUB).n).toBe(1)
  })

  it('keeps n within limit when already valid', () => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 4 }, DEFAULT_SETTINGS_STUB).n).toBe(4)
  })

  it('keeps valid size unchanged', () => {
    const result = normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '1024x1024' }, DEFAULT_SETTINGS_STUB)
    expect(result.size).toBe('1024x1024')
  })

  it('clears output_compression when format is png', () => {
    const result = normalizeParamsForSettings(
      { ...DEFAULT_PARAMS, output_format: 'png', output_compression: 80 },
      DEFAULT_SETTINGS_STUB,
    )
    expect(result.output_compression).toBeNull()
  })

  it('keeps output_compression when format is jpeg', () => {
    const result = normalizeParamsForSettings(
      { ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: 80 },
      DEFAULT_SETTINGS_STUB,
    )
    expect(result.output_compression).toBe(80)
  })
})
