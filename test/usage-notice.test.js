import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatCompactTokens,
  formatUsageNotice,
  injectedTextOf,
  isInjectionStep,
} from '../lib/usage-notice.js'

const WINDOW = 1_000_000

test('formatCompactTokens abbreviates to k/M without separators', () => {
  assert.equal(formatCompactTokens(0), '0')
  assert.equal(formatCompactTokens(999), '999')
  assert.equal(formatCompactTokens(1_000), '1k')
  assert.equal(formatCompactTokens(24_636), '25k')
  assert.equal(formatCompactTokens(317_397), '317k')
  assert.equal(formatCompactTokens(999_000), '999k')
  assert.equal(formatCompactTokens(999_999), '1M')
  assert.equal(formatCompactTokens(1_000_000), '1M')
  assert.equal(formatCompactTokens(1_500_000), '1.5M')
  assert.equal(formatCompactTokens(2_000_000), '2M')
  assert.equal(formatCompactTokens(200_000), '200k')
  assert.equal(formatCompactTokens(128_000), '128k')
})

test('formatUsageNotice emits the approved compact sentence', () => {
  assert.equal(
    formatUsageNotice({ projectedTokens: 317_397, contextWindow: WINDOW }),
    'Context window: 317k / 1M tokens used (32%)',
  )
})

test('formatUsageNotice prefers projectedTokens and falls back to pressureTokens', () => {
  assert.equal(
    formatUsageNotice({ projectedTokens: 250_000, pressureTokens: 200_000, contextWindow: WINDOW }),
    'Context window: 250k / 1M tokens used (25%)',
  )
  assert.equal(
    formatUsageNotice({ pressureTokens: 200_000, contextWindow: WINDOW }),
    'Context window: 200k / 1M tokens used (20%)',
  )
})

test('formatUsageNotice rounds the percentage to a whole number', () => {
  assert.match(formatUsageNotice({ projectedTokens: 333_333, contextWindow: WINDOW }), /\(33%\)$/)
  assert.match(formatUsageNotice({ projectedTokens: 999_999, contextWindow: WINDOW }), /\(100%\)$/)
  assert.match(formatUsageNotice({ projectedTokens: 1, contextWindow: 3 }), /\(33%\)$/)
  assert.match(formatUsageNotice({ projectedTokens: 200_000, contextWindow: 128_000 }), /\(156%\)$/)
})

test('formatUsageNotice keeps the compact window for non-million routes', () => {
  assert.equal(
    formatUsageNotice({ projectedTokens: 64_000, contextWindow: 128_000 }),
    'Context window: 64k / 128k tokens used (50%)',
  )
})

test('formatUsageNotice skips every unavailable or invalid input', () => {
  assert.equal(formatUsageNotice(undefined), undefined)
  assert.equal(formatUsageNotice({}), undefined)
  assert.equal(formatUsageNotice({ contextWindow: WINDOW }), undefined)
  assert.equal(formatUsageNotice({ projectedTokens: 10 }), undefined)
  assert.equal(formatUsageNotice({ projectedTokens: 10, contextWindow: 0 }), undefined)
  assert.equal(formatUsageNotice({ projectedTokens: 10, contextWindow: -1 }), undefined)
  assert.equal(formatUsageNotice({ projectedTokens: 10.5, contextWindow: WINDOW }), undefined)
  assert.equal(formatUsageNotice('nonsense'), undefined)
})

test('isInjectionStep injects on step 1 and every 20 steps after it', () => {
  const injected = []
  for (let step = 1; step <= 45; step += 1) if (isInjectionStep(step, 20)) injected.push(step)
  assert.deepEqual(injected, [1, 21, 41])
  assert.equal(isInjectionStep(1, 20), true)
  assert.equal(isInjectionStep(20, 20), false)
  assert.equal(isInjectionStep(40, 20), false)
  assert.equal(isInjectionStep(61, 20), true)
  assert.equal(isInjectionStep(1, 7), true)
  assert.equal(isInjectionStep(8, 7), true)
})

test('isInjectionStep rejects malformed cadence inputs', () => {
  assert.equal(isInjectionStep(0, 20), false)
  assert.equal(isInjectionStep(-1, 20), false)
  assert.equal(isInjectionStep(1.5, 20), false)
  assert.equal(isInjectionStep(1, 0), false)
  assert.equal(isInjectionStep(1, -20), false)
  assert.equal(isInjectionStep(1, 2.5), false)
})

test('injectedTextOf reads the notice back from its committed message', () => {
  const text = formatUsageNotice({ projectedTokens: 100_000, contextWindow: WINDOW })
  const message = {
    id: 'x',
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'context-window-reminder', form: 'snapshot', sections: [{ name: 'context-window-reminder', text }] },
  }
  assert.equal(injectedTextOf(message), text)
  assert.equal(injectedTextOf({ source: { kind: 'context-window-reminder' }, content: [{ type: 'text', text }] }), text)
  assert.equal(injectedTextOf({ source: {}, content: [] }), null)
  assert.equal(injectedTextOf(null), null)
  assert.equal(injectedTextOf({}), null)
})
