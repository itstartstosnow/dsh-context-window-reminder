# dsh-usage-reminder

[中文](README.md) | English

A lightweight context-window usage reminder for the agent — not an account/plan usage reminder.

DSH does not proactively inject the model's own context-window usage into each turn. The model sometimes has to guess how much room is left — e.g. it assumes the context is almost full and cuts corners. This plugin adds a lightweight reminder to the prompt telling the agent how much of its context it has used:

```
Context window: 392k / 1M tokens used (39%)
```

❌ Context only; it does not involve billing, plan, account usage, or any usage data.

Works on DeepSeek Harness (dsh) 0.2.1-rc.x. Host-only plugin; once installed it applies to every session.

## Before / after

Before, the model sees no occupancy data anywhere in its context. After, one collapsible context line follows your message:

```
you:    refactor this module
        Context window: 392k / 1M tokens used (39%)   ← new, collapsible, not a user message
model:  ... (knows ~60% is free and can follow the original plan)
```

- Not a user message: nothing to answer, no tool slot, no extra turn; the model just knows one more fact.
- Appended at the tail of history: your messages, the earlier conversation, and the system prompt are untouched.
- Long turns get a refreshed line every 20 steps (steps 1, 21, 41, …); if the numbers match the last injection, nothing is added.
- When the host has no measurement yet (for example the first step of a brand-new session), the plugin stays silent — no error, no placeholder.

## How it works

1. Reads the host's existing context occupancy (`contextPressure`), the same value behind the composer's context ring.
2. At each turn's first step, and every 20 steps after that, appends one context message with used / window / percent.
3. Never touches the system prompt, the compaction policy, or the tools; no advice, warnings, or thresholds.
4. Degrades silently when either number is unavailable.

Implementation details: [doc/technical.md](doc/technical.md) (Chinese).

## Performance

- About 13 tokens per injection, at most one every 20 steps; an 80-step turn adds fewer than 60 tokens in total.
- Appended at the tail only, so the system prompt and the cached history prefix are reused — no cache-breaking change.
- On other steps it costs one modulo check; no extra model calls, network requests, or perceivable latency.
- Never triggers a reply, a new turn, or a tool call.

## Install

Not published yet. Local install:

- In a dsh session, run `plugin_manager install_bundle` with `target: <absolute path to this directory>`.
- CLI: `dsh plugin --profile <profile> install link:<absolute path to this directory>`.

Installation usually applies live; after editing the linked code, restart dsh once so the module reloads. Once published to npm: `dsh plugin --profile <profile> install @itstartstosnow/dsh-usage-reminder`.

## Configuration and disabling

Defaults: every 20 steps, subagent sessions included. Override in the profile's `cordis.patch.yml` by row id (a patch replaces the whole config, so restate every field):

```yaml
- id: usage-reminder
  name: '@itstartstosnow/dsh-usage-reminder'
  config:
    everySteps: 20
    includeSubagents: true
```

| Field | Default | Meaning |
| --- | --- | --- |
| `everySteps` | `20` | Steps between two injections inside one turn |
| `includeSubagents` | `true` | Also inject into subagent sessions |

Disable: `plugin_manager set_plugin entryId: include:usage-reminder enabled: false`.
Remove: `plugin_manager remove_bundle target: @itstartstosnow/dsh-usage-reminder`.

## Known limitations

- The numbers are host estimates (same source as the composer ring), not billing-grade; that is enough for "how much room is left".
- The message you just sent in the current turn is not included (it is not written to the session when the number is taken), so the real request may be slightly larger.
- Only the model-visible context changes; the UI meter, compaction, and tool behavior are untouched.

## License

MIT — see [LICENSE](LICENSE).
