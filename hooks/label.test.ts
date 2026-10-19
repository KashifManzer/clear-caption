import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { captionOf, EDIT_REFUSAL, EDIT_RULE, modeOf, saysWhy } from './label'

const STEP = { turnId: 't', index: 0, model: 'm', messageCount: 1 }
const DONE = { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'tool_use', usage: null }

// Claude's reply as the engine streams it: per call, the tool chunk, then its arguments in two pieces.
const reply = (calls: { name: string; input: object }[]) =>
  calls.flatMap(({ name, input }, index) => {
    const json = JSON.stringify(input)
    return [{ kind: 'tool', index, id: `t${index}`, name }, { kind: 'input', index, json: json.slice(0, 5) }, { kind: 'input', index, json: json.slice(5) }]
  })

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
  const say = streams($, on)
  const bash = async (command: string, description: string) =>
    (await say(reply([{ name: 'Bash', input: { command, description } }]))).filter(s => typeof s === 'string').map(s => s.slice(5))

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

test('a call with nothing to say, or arguments that do not parse, passes with no line', async ($, on) => {
  mock.store(on)
  const say = streams($, on)

  const bare = reply([{ name: 'Bash', input: { command: 'ls' } }])
  expect(await say(bare)).toEqual(bare)

  const broken = [{ kind: 'tool', index: 0, id: 't0', name: 'Bash' }, { kind: 'input', index: 0, json: '{"command": "ls' }]
  expect(await say(broken)).toEqual(broken)

  for (const json of ['null', '5', '"x"', '[]']) {
    const odd = [{ kind: 'tool', index: 0, id: 't0', name: 'Bash' }, { kind: 'input', index: 0, json }]
    expect(await say(odd)).toEqual(odd)
  }
})

test('only a call that may get a line is held back: never in a subagent or with captions off', async ($, on) => {
  mock.store(on)
  const caption = (args: string) =>
    $.command.run({ command: 'caption', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  let seen = 0
  const rowOutFirst: boolean[] = []
  on('turn.step', async function* () {
    yield { kind: 'tool', index: 0, id: 't0', name: 'Bash' } as never
    // by the time the arguments come, a row not held is already out
    rowOutFirst.push(seen > 0)
    yield { kind: 'input', index: 0, json: '{"command":"ls","description":"List files"}' } as never
    return DONE as never
  })

  const step = async (agentId?: string) => {
    seen = 0
    for await (const _ of $.turn.step({ ...STEP, agentId })) seen++
    return seen
  }

  expect(await step('a1')).toBe(2)
  await caption('off')
  expect(await step()).toBe(2)
  await caption('risky')
  expect(await step()).toBe(2)
  await caption('all')
  expect(await step()).toBe(2)

  expect(rowOutFirst).toEqual([true, true, false, false])
})

test('saysWhy finds text right before the call in the reply that holds it', () => {
  const reply = (...content: object[]) => ({ role: 'assistant', content })
  const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x' }] }
  const edit = (id: string) => ({ type: 'tool_use', id, name: 'Edit' })
  const text = (t: string) => ({ type: 'text', text: t })

  expect(saysWhy([reply(text('Fix add: it subtracts.'), edit('e1'))], 'e1')).toBe(true)
  // thinking between the sentence and the call does not count against it
  expect(saysWhy([reply(text('Fix add.'), { type: 'thinking', thinking: '' }, { type: 'redacted_thinking' }, edit('e1'))], 'e1')).toBe(true)
  // the reply may sit before later tool results
  expect(saysWhy([reply(text('Fix add.'), edit('e1')), result], 'e1')).toBe(true)

  // the second call of a batch, a reply with no text, or empty text: no sentence
  expect(saysWhy([reply(text('Fix two things.'), edit('e1'), edit('e2'))], 'e2')).toBe(false)
  expect(saysWhy([reply(edit('e1'))], 'e1')).toBe(false)
  expect(saysWhy([reply({ type: 'thinking', thinking: 'why' }, edit('e1'))], 'e1')).toBe(false)
  expect(saysWhy([reply(text('  \n '), edit('e1'))], 'e1')).toBe(false)
  // text before an earlier reply's call is not this call's sentence
  expect(saysWhy([reply(text('Fix add.'), edit('e1')), result, reply(edit('e2'))], 'e2')).toBe(false)

  // nowhere to be found, or odd shapes: null, so the guard lets it through
  expect(saysWhy([], 'e1')).toBe(null)
  expect(saysWhy([reply(text('x'), edit('e1'))], 'e9')).toBe(null)
  expect(saysWhy([{ content: 'plain string' }, { content: null }, { content: [null, 5, 'x'] }], 'e1')).toBe(null)
})

test('the system prompt asks for a sentence before each edit, only when every caption is on', async ($, on) => {
  mock.store(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'core', scope: 'shared' }] }) as never)

  const compose = async () =>
    (await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })).sections
  const caption = (args: string) =>
    $.command.run({ command: 'caption', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  expect(await compose()).toEqual([
    { id: 'intro', text: 'core', scope: 'shared' },
    { id: 'clear-caption:edits', scope: 'session', text: EDIT_RULE },
  ])

  for (const mode of ['risky', 'off']) {
    await caption(mode)
    expect(await compose()).toEqual([{ id: 'intro', text: 'core', scope: 'shared' }])
  }
})

test('an edit without its sentence is refused once, then goes through', async ($, on) => {
  mock.store(on)
  let messages: object[] = []
  const ran: string[] = []

  on('session.messages', () => ({ value: messages }) as never)
  on('tool.call', { tool: ['Edit', 'Write'] }, ($, e) => (ran.push(e.tool_use_id), { result: 'done' }) as never)

  const reply = (id: string, said?: string) => [
    { role: 'assistant', content: [...(said === undefined ? [] : [{ type: 'text', text: said }]), { type: 'tool_use', id, name: 'Edit' }] },
  ]
  const edit = (tool_use_id: string, new_string = 'b') =>
    $.tool.call({ tool: 'Edit', tool_use_id, file_path: '/p/a.ts', old_string: 'a', new_string } as never)

  // with its sentence: runs
  messages = reply('e1', 'Fix add: it subtracts.')
  expect(await edit('e1')).toMatchObject({ result: 'done' })

  // without: refused, with what to do
  messages = reply('e2')
  expect(await edit('e2')).toEqual({ deny: EDIT_REFUSAL })

  // the same edit again, still without a sentence: goes through, so it cannot loop
  messages = reply('e3')
  expect(await edit('e3')).toMatchObject({ result: 'done' })
  // ...and only once: the next unexplained one is refused again
  messages = reply('e4')
  expect(await edit('e4')).toEqual({ deny: EDIT_REFUSAL })

  // a different edit without a sentence is its own refusal
  messages = reply('e5')
  expect(await edit('e5', 'c')).toEqual({ deny: EDIT_REFUSAL })

  // a call no reply holds is let through rather than guessed at
  messages = []
  expect(await edit('e6', 'd')).toMatchObject({ result: 'done' })

  expect(ran).toEqual(['e1', 'e3', 'e6'])
})

test('subagents and quieter modes are never refused', async ($, on) => {
  mock.store(on)
  on('session.messages', () => ({ value: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'Write' }] }] }) as never)
  on('tool.call', { tool: ['Edit', 'Write'] }, () => ({ result: 'done' }) as never)

  const write = (extra: object = {}) =>
    $.tool.call({ tool: 'Write', tool_use_id: 'e1', file_path: '/p/a.ts', content: 'x', ...extra } as never)
  const caption = (args: string) =>
    $.command.run({ command: 'caption', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  expect(await write({ agentId: 'a1' })).toMatchObject({ result: 'done' })

  await caption('risky')
  expect(await write()).toMatchObject({ result: 'done' })
  await caption('off')
  expect(await write()).toMatchObject({ result: 'done' })

  await caption('all')
  expect(await write()).toEqual({ deny: EDIT_REFUSAL })
})

test('when the transcript cannot be read, the edit still runs', async ($, on) => {
  mock.store(on)
  on('tool.call', { tool: ['Edit', 'Write'] }, () => ({ result: 'done' }) as never)

  // no session.messages answer at all: the guard fails and is skipped
  expect(await $.tool.call({ tool: 'Write', tool_use_id: 'e1', file_path: '/p/a.ts', content: 'x' } as never)).toMatchObject({ result: 'done' })
})
