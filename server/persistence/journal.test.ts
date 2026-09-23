// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Journal } from './journal'
import { fixtureDecision } from '../agent/fixtures.test-support'

it('persists immutable decisions and emergency controls across reopen', () => {
  const root = resolve(tmpdir())
  const folder = mkdtempSync(join(root, 'trading-journal-test-'))
  const path = join(folder, 'agent.sqlite')
  if (!resolve(folder).startsWith(root + '\\') && !resolve(folder).startsWith(root + '/'))
    throw new Error('Unsafe test cleanup path')
  let journal = new Journal(path)
  try {
    journal.saveDecision(fixtureDecision())
    journal.setState({ emergencyStop: true })
    journal.event('TEST_EVENT', 'test-decision', 'AAPL', { reason: 'test' })
    journal.close()
    journal = new Journal(path)
    expect(journal.decision('test-decision')?.evidence?.market?.price).toBe(100)
    expect(journal.state().emergencyStop).toBe(true)
    expect(journal.events('test-decision')).toHaveLength(1)
    expect(() => journal.saveDecision(fixtureDecision())).toThrow(Error)
  } finally {
    journal.close()
    rmSync(folder, { recursive: true, force: true })
  }
})
