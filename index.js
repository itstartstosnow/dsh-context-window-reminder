/**
 * dsh-usage-reminder — keeps the model informed of its own context-window
 * occupancy.
 *
 * Why: the host already measures prompt pressure (`contextPressure`) for the
 * composer's occupancy ring and for compaction, but none of those numbers enter
 * the model context. The model can only guess how much room remains from how
 * much it read, and it has guessed wrong (treating ~495k of 1M as almost full).
 * This plugin appends one fact-only notice to the model-visible history: at the
 * first step of each turn, and every `everySteps` steps after that.
 *
 * Design constraints, all acceptance-critical:
 * - The system prompt is never touched. Any byte change there would invalidate
 *   the prompt-prefix cache from the first differing token; a user-role message
 *   appended to the surface only grows the tail, so cached prefixes stay valid.
 * - The notice is a standalone `user/message` carrying its own `source.kind`.
 *   The Chat UI renders every non-`user` source as a collapsible context row,
 *   so the notice never looks like something the person typed and occupies no
 *   tool slot.
 * - Unavailable occupancy or window data means no message at all: no
 *   placeholder, no error, and no change to the turn.
 * - Identical numbers inside one turn are not injected twice. The last injected
 *   text is folded from the committed log (`usageReminder` projection), so the
 *   dedup rule survives attachment, restart, and fork.
 *
 * @module dsh-usage-reminder
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { formatUsageNotice, injectedTextOf, isInjectionStep } from './lib/usage-notice.js'

/** Stable Cordis plugin name; it is also the durable `source.kind` of the notice. */
const name = 'usage-reminder'

/** Mount only once the projection registry that holds `contextPressure` is available. */
const inject = ['sessionProjections']

/** Row config; every field has a default, so the bundle patch may omit `config`. */
const Config = z.object({
  everySteps: z.number().default(20),
  includeSubagents: z.boolean().default(true),
})

/** Durable projection state: the last notice text committed in the current turn. */
const stateSchema = zod.object({ lastTurnText: zod.string().nullable() })

/** Projection key owned by this plugin (host-only; no `wire` block). */
const STATE_KEY = 'usageReminder'

/** Projection key owned by `@deepseek-ai/dsh-token-meter`. */
const CONTEXT_PRESSURE_KEY = 'contextPressure'

/**
 * Register the dedup projection and the pre-step injection listener.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ everySteps?: number, includeSubagents?: boolean }} config - validated row config.
 */
function apply(ctx, config) {
  const everySteps = config.everySteps ?? 20
  const includeSubagents = config.includeSubagents ?? true
  if (!Number.isSafeInteger(everySteps) || everySteps < 1) {
    throw new TypeError(`usage-reminder: everySteps must be a positive integer, got ${String(everySteps)}`)
  }

  ctx.sessionProjections.register({
    key: STATE_KEY,
    stateVersion: 1,
    stateSchema,
    init: () => ({ lastTurnText: null }),
    apply: (state, event) => {
      // A new turn starts with no notice, so its first step is again eligible.
      if (event.type === 'turn/start') return state.lastTurnText === null ? state : { lastTurnText: null }
      if (event.type !== 'user/message' || event.data.source.kind !== name) return state
      const text = injectedTextOf(event.data)
      return text === state.lastTurnText ? state : { lastTurnText: text }
    },
  })

  // Prepend so the notice is the last message added to the step by listeners.
  ctx.on('agent/pre-step', (payload, next) => {
    if (!isInjectionStep(payload.step, everySteps)) return next()
    return injectBefore(payload, next)
  }, { prepend: true })

  /**
   * Append the notice to one eligible step, or return the untouched decision.
   * @param {{ agent: import('@deepseek-ai/dsh-agent').Agent, step: number, messages: readonly unknown[], signal: AbortSignal }} payload - pre-step facts.
   * @param {() => Promise<unknown>} next - the remaining waterfall.
   * @returns {Promise<unknown>} the step decision.
   */
  async function injectBefore({ agent, step, messages, signal }, next) {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    // A turn's first step only counts as "after a user message" when input
    // actually entered with it; otherwise an injection would create a request
    // the turn never needed.
    if (step === 1 && messages.length === 0) return decision
    if (!includeSubagents && agent.session.header.origin === 'subagent') return decision
    try {
      const { values } = ctx.sessionProjections.snapshot(agent.session, [CONTEXT_PRESSURE_KEY])
      const notice = formatUsageNotice(values[CONTEXT_PRESSURE_KEY])
      if (notice === undefined) return decision
      if (ctx.sessionProjections.stateOf(agent.session, STATE_KEY)?.lastTurnText === notice) return decision
      return {
        ...decision,
        messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text: notice }],
          source: { kind: name, form: 'snapshot', sections: [{ name, text: notice }] },
        })],
      }
    } catch (error) {
      // Degrade silently: the notice is optional context, never a turn failure.
      ctx.logger.debug('usage-reminder: skipped this step: %s', error)
      return decision
    }
  }
}

export { Config, apply, inject, name }
