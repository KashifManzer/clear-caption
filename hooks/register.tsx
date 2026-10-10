import type { Register } from 'claude-code'

import { captionOf } from './label'

// Says what a call does in plain words, as a dim transcript line, before it runs.
// A line of its own, not the tool row: another mod (a skin) may own the row, and no mod owns this.
export const register: Register = on => {
  on('tool.call', { tool: ['Bash', 'Agent'] }, ($, e, next) => {
    const caption = captionOf(e)

    if (caption !== null) {
      $.ui.log(caption)
    }

    return next(e)
  })
}
