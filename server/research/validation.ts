import { ProviderError } from '../errors'

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError(502, 'Invalid provider object.')
  }
  return value as Record<string, unknown>
}

/** Never coerce null, empty strings, booleans or non-finite numbers to zero. */
export function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function symbolValue(value: string): string {
  const symbol = value.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new ProviderError(400, 'Invalid symbol.')
  return symbol
}

export function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}
