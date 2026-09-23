import { readFileSync, writeFileSync } from 'node:fs'
import { backtest, type ReplayFrame } from './engine'
import { tradingConfig } from '../config/trading'

const [input, output] = process.argv.slice(2)
if (!input || !output)
  throw new Error('Usage: npm run backtest -- archived-frames.json results.json')
const frames = JSON.parse(readFileSync(input, 'utf8')) as ReplayFrame[]
if (!Array.isArray(frames) || frames.length > 100000)
  throw new Error('Expected bounded replay frame array')
const result = backtest(frames, tradingConfig({ TRADING_MODE: 'paper' }), 100000)
writeFileSync(output, JSON.stringify(result, null, 2))
console.log(`Replayed ${frames.length} frames; results written to ${output}`)
