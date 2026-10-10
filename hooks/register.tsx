import type { Register } from 'claude-code'

import { captionOf, modeOf } from './label'

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

  on('tool.call', { tool: ['Bash', 'Agent'] }, async ($, e, next) => {
    const caption = captionOf(e, modeOf(await $.store.get('mode')) ?? 'all')

    if (caption !== null) {
      $.ui.log(caption)
    }

    return next(e)
  })
}
