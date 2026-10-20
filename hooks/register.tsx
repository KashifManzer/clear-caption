import type { Register, TurnStepChunk, TurnStepInputChunk, TurnStepToolChunk } from 'claude-code'

import { captionOf, EDIT_ASK, modeOf } from './label'

const USAGE = 'Usage: /caption all|risky|off'
const SAYS = { all: 'every caption', risky: 'risky only (⚠ commands)', off: 'off' }
const EDITS = ['Edit', 'Write']

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

    // Claude Code keeps the tool descriptions a session started with, so the ask for edit lines comes with /clear.
    const edits = mode === 'all' && current !== 'all' ? '. Edit lines start after /clear if this session began without them' : ''

    return { text: `Captions: ${SAYS[mode]}${edits}` }
  })

  // Edit and Write have no description field, so under `/caption all` their description asks Claude to add one.
  // Claude Code keeps the descriptions a session started with, so a switch reaches edits after `/clear` or in a new
  // session; `$.ui.invalidate('tool.describe')` re-runs this hook but was seen not to change what Claude is sent.
  on('tool.describe', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const described = await next(e)

    if ((modeOf(await $.store.get('mode')) ?? 'all') !== 'all') {
      return described
    }

    return { ...described, description: `${described.description}\n\n${EDIT_ASK}` }
  })

  // Logged while Claude's reply streams in, right before the call's row is passed on, so the line sits above its
  // row. The row waits for its arguments, as the description is one of them; the call runs no later, since it
  // runs only on whole arguments. An edit's description is taken out before Claude Code checks the call, in every
  // mode and subagent, since Claude Code refuses an argument it doesn't know. Nothing here may throw: a stream hook
  // that fails loses what it holds.
  // ponytail: should Edit or Write ever get a real `description` argument, this would take it out too. The step's
  // result (`toolUses`) still lists the field for hooks above this one; the engine runs and records the chunks.
  on('turn.step', async function* ($, e, next) {
    const mode = modeOf(await $.store.get('mode')) ?? 'all'
    const quiet = e.agentId !== undefined || mode === 'off'

    let tool: TurnStepToolChunk | null = null
    let pieces: TurnStepInputChunk[] = []

    const release = (call: TurnStepToolChunk) => {
      let held: TurnStepChunk[] = [call, ...pieces]

      try {
        const args = JSON.parse(pieces.map(c => c.json).join(''))

        if (EDITS.includes(call.name) && Object.hasOwn(Object(args), 'description')) {
          const { description: _, ...rest } = args
          held = [call, { kind: 'input', index: call.index, json: JSON.stringify(rest) }]
        }

        const caption = quiet ? null : captionOf({ ...args, tool: call.name }, mode)

        if (caption !== null) {
          $.ui.log(caption)
        }
      } catch {
        // arguments that don't parse: the call can't run either, so it gets no caption
      }

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

      if (c.kind === 'tool' && (EDITS.includes(c.name) || (!quiet && (c.name === 'Bash' || c.name === 'Agent')))) {
        tool = c
        continue
      }

      yield c
    }

    if (tool !== null) {
      yield* release(tool)
    }
  })
}
