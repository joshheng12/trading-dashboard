// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { parseResearch } from './researchSchema'
import { research } from './aiResearch'
import { fixtureEvidence, fixtureReport, fixtureRegime } from '../agent/fixtures.test-support'

afterEach(() => vi.unstubAllEnvs())
it('accepts schema-valid research citing supplied evidence', () =>
  expect(parseResearch(JSON.stringify(fixtureReport()), fixtureEvidence())).toEqual(
    fixtureReport(),
  ))
it.each(['{}', 'not json', '{"symbol":"AAPL"}'])('rejects malformed AI JSON: %s', (value) =>
  expect(() => parseResearch(value, fixtureEvidence())).toThrow(Error),
)
it('rejects extra order instructions and unbounded scores', () => {
  expect(() => parseResearch({ ...fixtureReport(), order: 'BUY' }, fixtureEvidence())).toThrow(
    Error,
  )
  expect(() => parseResearch({ ...fixtureReport(), confidence: 101 }, fixtureEvidence())).toThrow(
    Error,
  )
})
it('rejects fabricated news citations', () => {
  const report = fixtureReport()
  report.newsAssessment.importantEvents[0]!.headlineId = 'https://invented.example'
  expect(() => parseResearch(report, fixtureEvidence())).toThrow('unsupplied headline')
})
it('fails closed on AI API failure', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
  vi.stubEnv('OPENAI_RESEARCH_MODEL', 'test-model')
  await expect(
    research(
      fixtureEvidence(),
      fixtureRegime,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 })),
    ),
  ).rejects.toThrow('AI provider unavailable')
})
it('passes no tools, account data, or brokerage keys to the AI', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
  vi.stubEnv('OPENAI_RESEARCH_MODEL', 'test-model')
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(fixtureReport()) }],
            },
          ],
        }),
      ),
    )
  await research(fixtureEvidence(), fixtureRegime, request)
  const body = JSON.parse(String(request.mock.calls[0]![1]!.body)) as Record<string, unknown>
  expect(body).not.toHaveProperty('tools')
  expect(body.store).toBe(false)
  expect(String(body.input)).not.toContain('buyingPower')
})
