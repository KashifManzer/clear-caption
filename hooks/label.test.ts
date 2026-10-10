import { expect, test } from 'claude-code/testing'

import { captionOf } from './label'

test('Bash and Agent use their description, nothing to say gives null', () => {
  expect(captionOf({ tool: 'Bash', description: 'Show working tree status' })).toBe('Show working tree status')
  expect(captionOf({ tool: 'Agent', description: 'Search the repo' })).toBe('Search the repo')
  expect(captionOf({ tool: 'Bash' })).toBe(null)
  expect(captionOf({ tool: 'Bash', description: '   ' })).toBe(null)
  expect(captionOf({ tool: 'Edit', description: 'x' })).toBe(null)
})

test('a subagent call is skipped', () => {
  expect(captionOf({ tool: 'Bash', description: 'List files', agentId: 'a1' })).toBe(null)
})

test('captions are one line with no control characters', () => {
  expect(captionOf({ tool: 'Bash', description: 'First line\nsecond line' })).toBe('First line')
  expect(captionOf({ tool: 'Bash', description: 'List files\r\nthen more' })).toBe('List files')
  expect(captionOf({ tool: 'Bash', description: '\n\nWhat it does' })).toBe('What it does')
  expect(captionOf({ tool: 'Bash', description: 'Clean\u001b[31m red \u001b[0mup' })).toBe('Clean[31m red [0mup')
  expect(captionOf({ tool: 'Bash', description: 'Ring\u0007 bell' })).toBe('Ring bell')
})

test('odd descriptions never throw', () => {
  for (const description of [null, undefined, 0, 5, [], {}, true]) {
    expect(() => captionOf({ tool: 'Bash', description })).not.toThrow()
    expect(captionOf({ tool: 'Bash', description })).toBe(null)
  }
})

test('a call logs its caption once and still runs, unchanged', async ($, on) => {
  const logs: string[] = []

  // stand in for the transcript and the tool, both beneath every plugin
  on('ui.log', ($, e, next) => {
    logs.push(e.text)
    return next(e)
  })
  on('tool.call', { tool: ['Bash', 'Read'] }, ($, e) => ({ result: { stdout: `ran ${e.tool}`, stderr: '' } }) as never)

  const ran = await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' })
  expect(ran.result).toEqual({ stdout: 'ran Bash', stderr: '' })
  expect(logs).toEqual(['List files'])

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: '/p/a.md' } as never)
  expect(logs).toEqual(['List files'])
})
