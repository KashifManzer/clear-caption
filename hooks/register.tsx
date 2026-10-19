import type { Register, TurnStepInputChunk, TurnStepToolChunk } from 'claude-code'

import { captionOf, EDIT_REFUSAL, EDIT_RULE, modeOf, saysWhy } from './label'

const USAGE = 'Usage: /caption all|risky|off'
const SAYS = { all: 'every caption', risky: 'risky only (⚠ commands)', off: 'off' }

// Says what a call does in plain words, as a dim transcript line, before it runs.
// A line of its own, not the tool row: another mod (a skin) may own the row, and no mod owns this.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'caption',
      description: 'Show tool captions: all, risky only, or off',
      argumentHint: 'all|risky|off',
      immediate: true,
    })

    return next(e)
  })

  // The mode lives in $.store, shared by every session and kept across restarts.
  on('command.run', { command: 'caption' }, async ($, e) => {
    const current = modeOf(await $.store.get('mode')) ?? 'all'

    if (e.args.trim() === '') {
      return { text: `Captions: ${SAYS[current]}. ${USAGE}` }
    }

    const mode = modeOf(e.args)

    if (mode === null) {
      return { text: `Captions stay ${SAYS[current]}. ${USAGE}` }
    }

    await $.store.set('mode', mode)

    return { text: `Captions: ${SAYS[mode]}` }
  })

  // Logged while Claude's reply streams in, right before the call's row is passed on, so the line sits above its
  // row. The row waits for its arguments, as the description is one of them; the call runs no later, since it
  // runs only on whole arguments. Nothing is held where no caption can come (a subagent, captions off), and
  // nothing here may throw: a stream hook that fails loses what it holds.
  on('turn.step', async function* ($, e, next) {
    const mode = modeOf(await $.store.get('mode')) ?? 'all'

    if (e.agentId !== undefined || mode === 'off') {
      return yield* next(e)
    }

    let tool: TurnStepToolChunk | null = null
    let pieces: TurnStepInputChunk[] = []

    const release = (call: TurnStepToolChunk) => {
      try {
        const caption = captionOf({ ...JSON.parse(pieces.map(c => c.json).join('')), tool: call.name }, mode)

        if (caption !== null) {
          $.ui.log(caption)
        }
      } catch {
        // arguments that don't parse: the call can't run either, so it gets no caption
      }

      const held = [call, ...pieces]
      tool = null
      pieces = []

      return held
    }

    for await (const c of next(e)) {
      if (tool !== null && c.kind === 'input' && c.index === tool.index) {
        pieces.push(c)
        continue
      }

      if (tool !== null) {
        yield* release(tool)
      }

      if (c.kind === 'tool' && (c.name === 'Bash' || c.name === 'Agent')) {
        tool = c
        continue
      }

      yield c
    }

    if (tool !== null) {
      yield* release(tool)
    }
  })

  // Edits get their caption from Claude itself: its system prompt asks for one sentence right before each.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    if ((modeOf(await $.store.get('mode')) ?? 'all') !== 'all') {
      return composed
    }

    return { sections: [...composed.sections, { id: 'clear-caption:edits', scope: 'session', text: EDIT_RULE }] }
  })

  // An edit that comes without its sentence is refused once, saying what to do; the same edit sent again goes
  // through, so it can never loop. A subagent's edits are left alone: its text never reaches the transcript.
  // ponytail: an edit refused and never sent again stays in the set; drop old keys if a session ever feels it.
  const refused = new Set<string>()

  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    if (e.agentId !== undefined || (modeOf(await $.store.get('mode')) ?? 'all') !== 'all') {
      return next(e)
    }

    const { tool_use_id, ...input } = e
    const key = JSON.stringify(input)

    if (refused.delete(key) || saysWhy(await $.session.messages({ as: 'api' }), tool_use_id) !== false) {
      return next(e)
    }

    refused.add(key)

    return { deny: EDIT_REFUSAL }
  })
}
