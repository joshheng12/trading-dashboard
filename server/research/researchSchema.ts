import type { Evidence, ResearchReport } from '../../src/types/research'

type Schema =
  | {
      type: 'object'
      properties: Record<string, Schema>
      required: string[]
      additionalProperties: false
    }
  | { type: 'string'; enum?: string[]; maxLength?: number }
  | { type: 'number'; minimum: number; maximum: number }
  | { type: 'array'; items: Schema; maxItems: number }
const object = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const text: Schema = { type: 'string', maxLength: 3000 }
const score: Schema = { type: 'number', minimum: 0, maximum: 100 }
const choice = (...values: string[]): Schema => ({ type: 'string', enum: values })
const list = (items: Schema): Schema => ({ type: 'array', items, maxItems: 30 })
export const researchSchema = object({
  symbol: text,
  technicalAssessment: object({
    trend: choice('bullish', 'neutral', 'bearish'),
    momentum: choice('strong', 'moderate', 'weak'),
    technicalScore: score,
  }),
  fundamentalAssessment: object({
    quality: choice('strong', 'average', 'weak', 'unknown'),
    valuation: choice('cheap', 'reasonable', 'expensive', 'unknown'),
    fundamentalScore: score,
  }),
  newsAssessment: object({
    sentiment: choice('positive', 'neutral', 'negative', 'mixed'),
    newsScore: score,
    importantEvents: list(object({ headlineId: text, interpretation: text })),
  }),
  risks: list(text),
  catalysts: list(text),
  bullCase: text,
  bearCase: text,
  confidence: score,
  dataQuality: object({ score, missingFields: list(text) }),
})

/** This small validator supports exactly the schema vocabulary above, including rejecting extra keys. */
function validate(value: unknown, schema: Schema, path = 'report'): void {
  const fail = () => {
    throw new Error(`Malformed AI output at ${path}`)
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
    const row = value as Record<string, unknown>
    if (Object.keys(row).some((key) => !Object.hasOwn(schema.properties, key))) return fail()
    for (const [key, child] of Object.entries(schema.properties))
      validate(row[key], child, `${path}.${key}`)
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) return fail()
    value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`))
  } else if (schema.type === 'number') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < schema.minimum ||
      value > schema.maximum
    )
      return fail()
  } else if (
    typeof value !== 'string' ||
    value.length > (schema.maxLength ?? 3000) ||
    (schema.enum && !schema.enum.includes(value))
  )
    fail()
}

export function parseResearch(input: unknown, evidence: Evidence): ResearchReport {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
  validate(value, researchSchema)
  const report = value as ResearchReport
  if (report.symbol !== evidence.symbol) throw new Error('AI symbol mismatch')
  const headlines = new Set(
    [...(evidence.companyNews ?? []), ...(evidence.marketNews ?? [])].map((n) => n.id),
  )
  if (report.newsAssessment.importantEvents.some((event) => !headlines.has(event.headlineId)))
    throw new Error('AI cited an unsupplied headline')
  if (
    report.newsAssessment.sentiment !== 'neutral' &&
    !report.newsAssessment.importantEvents.length
  )
    throw new Error('AI sentiment needs supplied headline citations')
  return report
}
