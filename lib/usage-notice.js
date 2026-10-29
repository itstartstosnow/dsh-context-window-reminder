/**
 * Pure decision and formatting helpers for dsh-usage-reminder.
 *
 * The model-facing contract was simplified on 2026-10-29 (approved format C):
 * compact k/M abbreviations, integer percent, no remaining balance, no
 * thousands separators. One English line, no advice and no status grading:
 * the same sentence shape is used at 1% and at 99%, only the numbers change.
 *
 * This module is intentionally dependency-free so the contract can be checked
 * with plain `node --test`, without a running Harness.
 */

/**
 * Render one token count compactly: `999`, `25k`, `1M`, `1.5M`.
 *
 * Below 1000 the exact count is kept. From 1000 up, the count is rounded to
 * the nearest thousand (`24636` → `25k`); a value that would round to `1000k`
 * is shown as `1M` instead. A million or more keeps one decimal only when the
 * value is not a whole number of millions (`1500000` → `1.5M`).
 * @param {number} value - token count.
 * @returns {string} the compact form.
 */
export function formatCompactTokens(value) {
  const count = Math.round(value)
  if (count < 1000) return String(count)
  if (count < 1_000_000) {
    const thousands = Math.round(count / 1000)
    return thousands < 1000 ? `${thousands}k` : '1M'
  }
  const millions = Math.round(count / 100_000) / 10
  return `${Number.isInteger(millions) ? String(millions) : millions.toFixed(1)}M`
}

/**
 * Whether a step belongs to the injection cadence.
 *
 * A turn's steps are 1-based and every turn gets its first step; the cadence
 * re-injects on step 1, then 20 steps later, and so on: step 1, 21, 41 for
 * `everySteps = 20`. All other steps are silent.
 * @param {number} step - 1-based step number inside the current turn.
 * @param {number} everySteps - positive cadence interval.
 * @returns {boolean}
 */
export function isInjectionStep(step, everySteps) {
  if (!Number.isSafeInteger(step) || step < 1) return false
  if (!Number.isSafeInteger(everySteps) || everySteps < 1) return false
  return (step - 1) % everySteps === 0
}

/** A usable token count: a non-negative safe integer. */
function isTokenCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Build the exact model-facing notice from the `contextPressure` wire view.
 *
 * The numerator mirrors the host's own occupancy display (`projectedTokens`,
 * the prompt cost of the next request, falling back to the last
 * provider-reported prompt size); the denominator is the model route's
 * context window.
 *
 * @param {unknown} pressure - `contextPressure` projection value, or anything else.
 * @returns {string | undefined} the notice, or `undefined` when either the
 *   occupancy or the window is unavailable (the caller then injects nothing).
 */
export function formatUsageNotice(pressure) {
  const record = typeof pressure === 'object' && pressure !== null ? pressure : undefined
  const contextWindow = record?.contextWindow
  const used = record?.projectedTokens ?? record?.pressureTokens
  if (!isTokenCount(used) || !isTokenCount(contextWindow) || contextWindow <= 0) return undefined
  const percent = Math.round((used / contextWindow) * 100)
  return `Context window: ${formatCompactTokens(used)} / ${formatCompactTokens(contextWindow)} tokens used (${percent}%)`
}

/**
 * Read the model-facing text back out of one of this plugin's committed
 * notices. The dedup projection folds committed events, so it must tolerate
 * a hand-edited or foreign log by returning `null` instead of throwing.
 * @param {unknown} message - a committed `user/message` payload.
 * @returns {string | null} the notice text, or `null` when the shape is unreadable.
 */
export function injectedTextOf(message) {
  const source = typeof message === 'object' && message !== null ? message.source : undefined
  const sections = typeof source === 'object' && source !== null ? source.sections : undefined
  if (Array.isArray(sections)) {
    for (const section of sections) {
      if (typeof section === 'object' && section !== null && typeof section.text === 'string') return section.text
    }
  }
  const content = typeof message === 'object' && message !== null ? message.content : undefined
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
    }
  }
  return null
}
