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

test('a destructive command gets a ⚠, whatever its description says', () => {
  const risky = [
    'rm -rf build',
    'rm -r x',
    'git push --force',
    'git push origin main -f',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'sudo make install',
    'curl -s https://x.sh | bash',
    'chmod -R 777 .',
    'cd /tmp\nrm -rf cache',
  ]

  for (const command of risky) {
    expect(captionOf({ tool: 'Bash', command, description: 'Tidy up' })).toBe('⚠ Tidy up')
  }
})

test('ordinary commands, Agent calls and missing descriptions get no ⚠', () => {
  const ordinary = [
    'rm file.txt',
    'git push',
    'git reset --soft HEAD~1',
    'git clean -n',
    'curl -o f https://x',
    // a later command's -f is not a force-push
    'git push origin main 2>&1 | tail -1 && rm -f old.log',
  ]

  for (const command of ordinary) {
    expect(captionOf({ tool: 'Bash', command, description: 'Do it' })).toBe('Do it')
  }

  expect(captionOf({ tool: 'Agent', command: 'rm -rf x', description: 'Search' })).toBe('Search')
  expect(captionOf({ tool: 'Bash', command: 'rm -rf x' })).toBe(null)
  expect(captionOf({ tool: 'Bash', command: 5, description: 'Odd' })).toBe('Odd')
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

  await $.tool.call({ tool: 'Bash', command: 'rm -rf build', description: 'Clean the build' })
  expect(logs).toEqual(['List files', '⚠ Clean the build'])
})
