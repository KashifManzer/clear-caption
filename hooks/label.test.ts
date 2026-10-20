import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { captionOf, EDIT_ASK, modeOf } from './label'

const STEP = { turnId: 't', index: 0, model: 'm', messageCount: 1 }
const DONE = { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }

// Claude's reply as the engine streams it: per call, the tool chunk, then its arguments in two pieces.
const reply = (calls: { name: string; input: object }[]) =>
  calls.flatMap(({ name, input }, index) => {
    const json = JSON.stringify(input)
    return [{ kind: 'tool', index, id: `t${index}`, name }, { kind: 'input', index, json: json.slice(0, 5) }, { kind: 'input', index, json: json.slice(5) }]
  })

// What typing `/caption <args>` at the prompt sends.
const caption = async ($: Parameters<TestBody>[0], args: string) =>
  (await $.command.run({ command: 'caption', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text

// Streams a reply from beneath every plugin; resolves to what comes out on top, each logged line in its place.
function streams($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const seen: unknown[] = []
  let chunks: object[] = []

  // stand in for the transcript and the model, both beneath every plugin
  on('ui.log', ($, e, next) => {
    seen.push(`log: ${e.text}`)
    return next(e)
  })
  on('turn.step', async function* () {
    yield* chunks as never[]
    return DONE as never
  })

  return async (next: object[], agentId?: string) => {
    chunks = next
    seen.length = 0

    for await (const c of $.turn.step({ ...STEP, agentId })) {
      seen.push(c)
    }

    return [...seen]
  }
}

test('Bash, Agent, Edit and Write use their description, nothing to say gives null', () => {
  expect(captionOf({ tool: 'Bash', description: 'Show working tree status' })).toBe('Show working tree status')
  expect(captionOf({ tool: 'Agent', description: 'Search the repo' })).toBe('Search the repo')
  expect(captionOf({ tool: 'Edit', description: 'Fix add: it subtracts.' })).toBe('Fix add: it subtracts.')
  expect(captionOf({ tool: 'Write', description: 'Add the notes file.' })).toBe('Add the notes file.')
  expect(captionOf({ tool: 'Bash' })).toBe(null)
  expect(captionOf({ tool: 'Bash', description: '   ' })).toBe(null)
  expect(captionOf({ tool: 'Read', description: 'x' })).toBe(null)
  expect(captionOf({ tool: 'NotebookEdit', description: 'x' })).toBe(null)
})

test('a subagent call is skipped', () => {
  expect(captionOf({ tool: 'Bash', description: 'List files', agentId: 'a1' })).toBe(null)
  expect(captionOf({ tool: 'Edit', description: 'Fix add', agentId: 'a1' })).toBe(null)
})

test('captions are one line with no control characters', () => {
  expect(captionOf({ tool: 'Bash', description: 'First line\nsecond line' })).toBe('First line')
  expect(captionOf({ tool: 'Bash', description: 'List files\r\nthen more' })).toBe('List files')
  expect(captionOf({ tool: 'Bash', description: '\n\nWhat it does' })).toBe('What it does')
  expect(captionOf({ tool: 'Bash', description: 'Clean\u001b[31m red \u001b[0mup' })).toBe('Clean[31m red [0mup')
  expect(captionOf({ tool: 'Bash', description: 'Ring\u0007 bell' })).toBe('Ring bell')
  expect(captionOf({ tool: 'Edit', description: 'Fix add\u001b]0;pwned\u0007\nmore' })).toBe('Fix add]0;pwned')
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
    // recursive flags the old pattern missed
    'rm -f -r old',
    'rm --recursive old',
    // one temp target does not excuse the other
    'rm -rf /tmp/x src',
    // a variable can point anywhere, and .. climbs out of temp
    'rm -rf $S/e2e',
    'S=/Users/me/project; rm -rf $S/src',
    'S=/tmp/a; S=/Users/me; rm -rf $S',
    // order is not followed (loops, functions), so any non-temp value keeps the ⚠
    'S=/Users/me; S=/tmp/a; rm -rf $S',
    'rm -rf /tmp/../Users/me/project',
    // throwing away work in git, and deleting by search
    'git checkout -- src/app.ts',
    'git checkout .',
    'git restore .',
    'git restore src/app.ts',
    'git branch -D old-feature',
    'git stash drop',
    'git stash clear',
    'find . -name "*.log" -delete',
  ]

  for (const command of risky) {
    expect(captionOf({ tool: 'Bash', command, description: 'Tidy up' })).toBe('⚠ Tidy up')
  }
})

test('deleting only temp folders, and safe git, get no ⚠', () => {
  const calm = [
    'rm -rf /tmp/build-123',
    'rm -rf /private/tmp/claude-501/-Users-apple-Desktop/abc/scratchpad/e2e',
    'rm -rf "$TMPDIR/cache" ${TMPDIR}/more',
    'rm -r /var/folders/7q/xyz/T/run',
    'mkdir -p /tmp/a && rm -r /tmp/a && echo done',
    'rm -rf /tmp/x 2>/dev/null',
    // a variable the same command points at a temp folder
    'S=/private/tmp/claude-501/x/scratchpad; rm -rf $S/e2e && mkdir -p $S/e2e',
    'export D="/tmp/run"; rm -rf "${D}/out"',
    'git restore --staged src/app.ts',
    'git checkout main',
    'git checkout -b feature',
    'git branch -d merged',
    'git stash pop',
    'find . -name "*.log" -print',
  ]

  for (const command of calm) {
    expect(captionOf({ tool: 'Bash', command, description: 'Tidy up' })).toBe('Tidy up')
  }
})

test('ordinary commands, Agent calls, edits and missing descriptions get no ⚠', () => {
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
  expect(captionOf({ tool: 'Write', command: 'rm -rf x', description: 'Add a script' })).toBe('Add a script')
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
  const edit = { tool: 'Edit', description: 'Fix add' }

  expect(captionOf(safe, 'all')).toBe('List files')
  expect(captionOf(risky, 'all')).toBe('⚠ Clean the build')
  expect(captionOf(edit, 'all')).toBe('Fix add')
  expect(captionOf(safe, 'risky')).toBe(null)
  expect(captionOf(risky, 'risky')).toBe('⚠ Clean the build')
  expect(captionOf(edit, 'risky')).toBe(null)
  expect(captionOf(safe, 'off')).toBe(null)
  expect(captionOf(risky, 'off')).toBe(null)
  expect(captionOf(edit, 'off')).toBe(null)
})

test('/caption switches the mode, remembers it, and refuses a bad choice', async ($, on) => {
  mock.store(on)
  const say = streams($, on)
  const bash = async (command: string, description: string) =>
    (await say(reply([{ name: 'Bash', input: { command, description } }]))).filter(s => typeof s === 'string').map(s => s.slice(5))

  expect(await bash('ls', 'List files')).toEqual(['List files'])

  expect(await caption($, 'risky')).toMatch(/risky/)
  expect(await bash('ls', 'List files')).toEqual([])
  expect(await bash('rm -rf build', 'Clean the build')).toEqual(['⚠ Clean the build'])

  expect(await caption($, 'loud')).toMatch(/all\|risky\|off/)
  // the bad choice changed nothing
  expect(await caption($, '')).toMatch(/risky only/)

  await caption($, 'off')
  expect(await bash('rm -rf build', 'Clean the build')).toEqual([])

  // edits are asked for their line only from the next /clear, so switching back on says so
  expect(await caption($, 'all')).toBe('Captions: every caption. Edit lines start after /clear if this session began without them')
  expect(await bash('ls', 'List files')).toEqual(['List files'])
  expect(await caption($, 'all')).toBe('Captions: every caption')
  expect(await caption($, 'risky')).toBe('Captions: risky only (⚠ commands)')
})

test('odd descriptions never throw', () => {
  for (const description of [null, undefined, 0, 5, [], {}, true]) {
    expect(() => captionOf({ tool: 'Bash', description })).not.toThrow()
    expect(captionOf({ tool: 'Bash', description })).toBe(null)
  }
})

test('a caption is logged right before its call, and the reply passes on unchanged', async ($, on) => {
  mock.store(on)
  const say = streams($, on)

  const text = { kind: 'text', index: 9, text: 'Fixing it.' }
  const after = { kind: 'text', index: 8, text: 'Now the rest.' }
  const stop = { kind: 'stop', stopReason: 'tool_use', usage: null }
  const calls = reply([
    { name: 'Bash', input: { command: 'ls', description: 'List files' } },
    { name: 'Read', input: { file_path: '/p/a.md' } },
    { name: 'Agent', input: { description: 'Search the repo', prompt: 'find x' } },
    { name: 'Bash', input: { command: 'rm -rf build', description: 'Clean the build' } },
  ])
  const [ls, read, agent, rm] = [0, 3, 6, 9].map(i => calls.slice(i, i + 3))

  // calls back to back, or with text or the stop after one: each is let out whole, its line first
  expect(await say([text, ...ls!, after, ...read!, ...agent!, ...rm!, stop])).toEqual([
    text,
    'log: List files',
    ...ls!,
    after,
    ...read!,
    'log: Search the repo',
    ...agent!,
    'log: ⚠ Clean the build',
    ...rm!,
    stop,
  ])

  // a call that ends the stream is let out too
  expect(await say(ls!)).toEqual(['log: List files', ...ls!])
})

test('each edit in a batch gets its own line above its row, and Claude Code never sees the description', async ($, on) => {
  mock.store(on)
  const say = streams($, on)

  const stop = { kind: 'stop', stopReason: 'tool_use', usage: null }
  const fix = { file_path: '/p/a.js', old_string: 'a - b', new_string: 'a + b' }
  // quotes, newlines, emoji and a lone surrogate come out as they went in
  const notes = { file_path: '/p/n.md', content: 'say "hi"\n\tline ✓ 😀 \ud800' }
  // text that only looks like the field, inside another argument, is left alone
  const tricky = { file_path: '/p/b.js', old_string: 'x', new_string: '{"description": "not mine"}', replace_all: true }
  const calls = reply([
    { name: 'Edit', input: { description: 'Fix add: it subtracts.', ...fix } },
    { name: 'Write', input: { description: 'Add the notes file.', ...notes } },
    { name: 'Bash', input: { command: 'ls', description: 'List files' } },
    { name: 'Edit', input: tricky },
    // another tool keeps whatever it was sent
    { name: 'Read', input: { file_path: '/p/a.md', description: 'x' } },
  ])
  const [edit, write, bash, plain, read] = [0, 3, 6, 9, 12].map(i => calls.slice(i, i + 3))
  const without = (index: number, input: object) => ({ kind: 'input', index, json: JSON.stringify(input) })

  expect(await say([...calls, stop])).toEqual([
    'log: Fix add: it subtracts.',
    edit![0],
    without(0, fix),
    'log: Add the notes file.',
    write![0],
    without(1, notes),
    'log: List files',
    ...bash!,
    ...plain!,
    ...read!,
    stop,
  ])
})

test("an edit's description is taken out in every mode and in a subagent, with a line only under all", async ($, on) => {
  mock.store(on)
  const say = streams($, on)

  const edit = reply([{ name: 'Edit', input: { description: 'Fix add', file_path: '/p/a.js', old_string: 'a', new_string: 'b' } }])
  const stripped = [edit[0], { kind: 'input', index: 0, json: '{"file_path":"/p/a.js","old_string":"a","new_string":"b"}' }]

  expect(await say(edit)).toEqual(['log: Fix add', ...stripped])
  expect(await say(edit, 'a1')).toEqual(stripped)

  for (const mode of ['risky', 'off']) {
    await caption($, mode)
    expect(await say(edit)).toEqual(stripped)
  }

  // a description that says nothing is still taken out, with no line
  await caption($, 'all')
  for (const description of ['', '  ', null, 5, {}]) {
    const odd = reply([{ name: 'Write', input: { description, file_path: '/p/a', content: 'x' } }])
    expect(await say(odd)).toEqual([odd[0], { kind: 'input', index: 0, json: '{"file_path":"/p/a","content":"x"}' }])
  }
})

test('a call with nothing to say, or arguments that do not parse, passes with no line', async ($, on) => {
  mock.store(on)
  const say = streams($, on)

  for (const name of ['Bash', 'Edit', 'Write']) {
    const bare = reply([{ name, input: { file_path: '/p/a', command: 'ls' } }])
    expect(await say(bare)).toEqual(bare)

    const broken = [{ kind: 'tool', index: 0, id: 't0', name }, { kind: 'input', index: 0, json: '{"description": "Fix' }]
    expect(await say(broken)).toEqual(broken)

    for (const json of ['null', '5', '"x"', '[]', '["description"]']) {
      const odd = [{ kind: 'tool', index: 0, id: 't0', name }, { kind: 'input', index: 0, json }]
      expect(await say(odd)).toEqual(odd)
    }
  }
})

test('Bash is held back only where it may get a line; an edit always is, to take its description out', async ($, on) => {
  mock.store(on)

  let name = ''
  let seen = 0
  const rowOutFirst: boolean[] = []
  on('turn.step', async function* () {
    yield { kind: 'tool', index: 0, id: 't0', name } as never
    // by the time the arguments come, a row not held is already out
    rowOutFirst.push(seen > 0)
    yield { kind: 'input', index: 0, json: '{"description":"Say it"}' } as never
    return DONE as never
  })

  const step = async (tool: string, agentId?: string) => {
    name = tool
    seen = 0
    for await (const _ of $.turn.step({ ...STEP, agentId })) seen++
    return seen
  }

  for (const mode of ['all', 'risky', 'off']) {
    await caption($, mode)
    expect(await step('Bash')).toBe(2)
    expect(await step('Bash', 'a1')).toBe(2)
    expect(await step('Edit')).toBe(2)
    expect(await step('Write', 'a1')).toBe(2)
  }

  expect(rowOutFirst).toEqual([false, true, false, false, false, true, false, false, true, true, false, false])
})

test('edits are asked for a description only under all, and keep the rest of what they say', async ($, on) => {
  mock.store(on)
  // stand in for the engine's own description, beneath every plugin
  on('tool.describe', ($, e) => ({ description: e.description, isDeferred: false }))

  const describe = (tool: string) =>
    $.tool.describe({ tool, description: `${tool} does things.`, provider: { plugin: 'engine', tier: 'core' } } as never)

  expect(await describe('Edit')).toEqual({ description: `Edit does things.\n\n${EDIT_ASK}`, isDeferred: false })
  expect(await describe('Write')).toEqual({ description: `Write does things.\n\n${EDIT_ASK}`, isDeferred: false })

  for (const tool of ['Bash', 'Read', 'NotebookEdit']) {
    expect(await describe(tool)).toEqual({ description: `${tool} does things.`, isDeferred: false })
  }

  for (const mode of ['risky', 'off']) {
    await caption($, mode)
    expect(await describe('Edit')).toEqual({ description: 'Edit does things.', isDeferred: false })
  }

  await caption($, 'all')
  expect(await describe('Write')).toEqual({ description: `Write does things.\n\n${EDIT_ASK}`, isDeferred: false })
})
