import { expect, test } from 'claude-code/testing'

import { commandOf, labelFor, stateOf } from './label'

const call = { tool_use_id: 't1', isRunning: false, isErrored: false, isInterrupted: false, onScreen: null }

test('bash uses its description, missing description leaves the engine text', () => {
  expect(labelFor('Bash', { command: 'git status', description: 'Show working tree status' })).toBe('Show working tree status')
  expect(labelFor('Bash', { command: 'npm run build' })).toBe(null)
  expect(labelFor('Bash', { command: 'x', description: '   ' })).toBe(null)
})

test('other tools derive from input, unknown tools are left alone', () => {
  expect(labelFor('Edit', { file_path: '/a/b/app.ts' })).toBe('Editing app.ts')
  expect(labelFor('NotebookEdit', { notebook_path: '/a/b/analysis.ipynb' })).toBe('Editing analysis.ipynb')
  expect(labelFor('Edit', {})).toBe(null)
  expect(labelFor('Unknown', { description: 'x' })).toBe(null)
  expect(labelFor('Bash', { description: 'First line\nsecond line' })).toBe('First line')
})

test('the real command is offered for Bash only, first line, cut when long', () => {
  expect(commandOf('Bash', { command: 'ls -la\nrm -rf x' })).toBe('$ ls -la')
  expect(commandOf('Bash', { command: 'a'.repeat(200) })).toBe(`$ ${'a'.repeat(159)}…`)
  expect(commandOf('Bash', {})).toBe(null)
  expect(commandOf('Edit', { command: 'x' })).toBe(null)
})

test('failed and interrupted calls keep their signal', () => {
  expect(stateOf({})).toEqual({ color: undefined, note: '' })
  expect(stateOf({ isErrored: true })).toEqual({ color: 'error', note: ' (failed)' })
  expect(stateOf({ isInterrupted: true, isErrored: true })).toEqual({ color: 'warning', note: ' (interrupted)' })
})

test('the row draws the label, and the state, on the terminal and desktop', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const props = { ...call, tool: 'Bash', input: { command: 'ls', description: 'List files' } }

    const ok = await $.ui.mount({ plugin: 'clear-caption', surface, component: 'ToolUse', requestId: 't1', props })
    expect(await ok.find({ type: 'Text', text: /List files/ })).toBeDefined()
    await ok.unmount()

    const bad = await $.ui.mount({ plugin: 'clear-caption', surface, component: 'ToolUse', requestId: 't2', props: { ...props, isErrored: true } })
    expect(await bad.find({ type: 'Text', text: /\(failed\)/ })).toBeDefined()
    await bad.unmount()

    // running: the real command shows under the label; finished: the engine's box has it, so no repeat
    const running = await $.ui.mount({ plugin: 'clear-caption', surface, component: 'ToolUse', requestId: 't3', props: { ...props, isRunning: true } })
    expect(await running.find({ type: 'Text', text: /\$ ls/ })).toBeDefined()
    await running.unmount()

    const done = await $.ui.mount({ plugin: 'clear-caption', surface, component: 'ToolUse', requestId: 't4', props })
    expect(await done.find({ type: 'Text', text: /\$ ls/ })).toBeUndefined()
    await done.unmount()
  }
})
