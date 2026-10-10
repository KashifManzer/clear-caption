import type { Register } from 'claude-code'

import { commandOf, labelFor, stateOf } from './label'

// The tool row says what the call does in plain words; the engine's own command box stays.
export const register: Register = on => {
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    const label = labelFor(e.props.tool, e.props.input)

    if (label === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const { color, note } = stateOf(e.props)
    const command = e.props.isRunning ? commandOf(e.props.tool, e.props.input) : null

    const row = (
      <Box>
        <Text color={color}>● </Text>
        <Text bold>
          {label}
          {note}
        </Text>
      </Box>
    )

    if (command === null) {
      return row
    }

    return (
      <Box flexDirection="column">
        {row}
        <Text dimColor>  {command}</Text>
      </Box>
    )
  })
}
