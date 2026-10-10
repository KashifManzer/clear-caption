import { expect, mock, test } from 'claude-code/testing'

import { captionOf, modeOf } from './label'

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

test('modeOf reads the three modes and refuses the rest', () => {
  expect(modeOf('all')).toBe('all')
  expect(modeOf(' RISKY ')).toBe('risky')
  expect(modeOf('off')).toBe('off')

  for (const bad of ['', 'on', 'quiet', undefined, null, 1, {}]) {
    expect(modeOf(bad)).toBe(null)
  }
})

test('each mode shows what it promises', () => {
  const safe = { tool: 'Bash', command: 'ls', description: 'List files' }
  const risky = { tool: 'Bash', command: 'rm -rf build', description: 'Clean the build' }

  expect(captionOf(safe, 'all')).toBe('List files')
  expect(captionOf(risky, 'all')).toBe('⚠ Clean the build')
  expect(captionOf(safe, 'risky')).toBe(null)
  expect(captionOf(risky, 'risky')).toBe('⚠ Clean the build')
  expect(captionOf(safe, 'off')).toBe(null)
  expect(captionOf(risky, 'off')).toBe(null)
})

test('/caption switches the mode, remembers it, and refuses a bad choice', async ($, on) => {
  mock.store(on)
  const logs: string[] = []

  on('ui.log', ($, e, next) => {
    logs.push(e.text)
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '' } }) as never)

  const bash = async (command: string, description: string) => {
    logs.length = 0
    await $.tool.call({ tool: 'Bash', command, description })
    return [...logs]
  }

  // what typing `/caption <args>` at the prompt sends
  const caption = async (args: string) =>
    (await $.command.run({ command: 'caption', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text

  expect(await bash('ls', 'List files')).toEqual(['List files'])

  expect(await caption('risky')).toMatch(/risky/)
  expect(await bash('ls', 'List files')).toEqual([])
  expect(await bash('rm -rf build', 'Clean the build')).toEqual(['⚠ Clean the build'])

  expect(await caption('loud')).toMatch(/all\|risky\|off/)
  // the bad choice changed nothing
  expect(await caption('')).toMatch(/risky only/)

  await caption('off')
  expect(await bash('rm -rf build', 'Clean the build')).toEqual([])

  await caption('all')
  expect(await bash('ls', 'List files')).toEqual(['List files'])
})

test('odd descriptions never throw', () => {
  for (const description of [null, undefined, 0, 5, [], {}, true]) {
    expect(() => captionOf({ tool: 'Bash', description })).not.toThrow()
    expect(captionOf({ tool: 'Bash', description })).toBe(null)
  }
})

test('a call logs its caption once and still runs, unchanged', async ($, on) => {
  mock.store(on)
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
