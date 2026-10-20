const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// Model-written text is cut to one line and stripped of control characters (ESC, CR, BEL...)
// before it reaches the terminal.
const line = (s: string) => (s.split(/\r\n|\n|\r/)[0] ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()

// ponytail: a short list of destructive spellings; others (git push origin +main) slip through, and text inside
// quotes or heredocs is read as a command too. Add a pattern when a real miss or false alarm shows up.
const RISKY = /\bgit\s+push\b[^\n;&|]*\s(-f|--force)\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-zA-Z]*f|\bgit\s+checkout\s+(--\s|\.(\s|$))|\bgit\s+restore\b(?![^\n;&|]*--staged)|\bgit\s+branch\s+-D\b|\bgit\s+stash\s+(drop|clear)\b|\bfind\b[^\n;&|]*\s-delete\b|\bsudo\b|\bcurl\b[^|\n]*\|\s*(ba|z)?sh\b|\bchmod\s+-R\b/

// Temp locations a recursive delete may clear without a ⚠.
const TEMP = /^(\/tmp\/|\/private\/tmp\/|\/var\/folders\/|\$\{?TMPDIR\}?\/)|\/scratchpad\//

// A recursive `rm` with a target outside temp locations, or none named. Redirections are not targets,
// and `..` can climb out of temp, so it never counts as one. A `$VAR` the same command sets is read as
// its value; one set twice keeps a value that is not temp, so it stays flagged.
function deletesWork(command: string): boolean {
  const vars = new Map<string, string>()

  for (const [, name = '', value = ''] of command.matchAll(/(?:^|[\s;&])([A-Za-z_]\w*)=["']?([^\s;&"']+)/g)) {
    const kept = vars.get(name)

    if (kept === undefined || TEMP.test(kept)) {
      vars.set(name, value)
    }
  }

  for (const [, args = ''] of command.matchAll(/\brm\s+([^\n;&|]*)/g)) {
    const words = args.split(/\s+/).filter(w => w !== '' && !/^\d*[<>]/.test(w))
    const isRecursive = words.some(w => /^-[a-zA-Z]*[rR]/.test(w) || w === '--recursive')
    const targets = words
      .filter(w => !w.startsWith('-'))
      .map(w => w.replace(/^["']|["']$/g, '').replace(/^\$\{?(\w+)\}?/, (whole, name: string) => vars.get(name) ?? whole))

    if (isRecursive && (targets.length === 0 || targets.some(t => !TEMP.test(t) || t.includes('..')))) {
      return true
    }
  }

  return false
}

// What `/caption` shows: every caption, only the ⚠ ones, or none.
export type Mode = 'all' | 'risky' | 'off'

export function modeOf(v: unknown): Mode | null {
  const mode = str(v).toLowerCase()
  return mode === 'all' || mode === 'risky' || mode === 'off' ? mode : null
}

// Plain-language caption for a tool call, or null to say nothing.
// Bash, Agent, Edit and Write carry the model's `description` (a claim, not proof: the tool row keeps the real
// command or diff), so a destructive command is marked whatever its description says.
// A subagent's own calls are skipped so they don't flood the main transcript.
export function captionOf(e: { tool: string; agentId?: string; description?: unknown; command?: unknown }, mode: Mode = 'all'): string | null {
  if (mode === 'off' || e.agentId !== undefined || !['Bash', 'Agent', 'Edit', 'Write'].includes(e.tool)) {
    return null
  }

  const caption = line(str(e.description))

  if (caption === '') {
    return null
  }

  const command = str(e.command)

  if (e.tool === 'Bash' && (RISKY.test(command) || deletesWork(command))) {
    return `⚠ ${caption}`
  }

  return mode === 'all' ? caption : null
}

// Edit and Write have no description field, so their tool description asks Claude to add one; the field is taken
// out before Claude Code checks the call, as it refuses arguments it doesn't know.
export const EDIT_ASK =
  'IMPORTANT: this tool takes one more argument than its schema lists: `description` (string, required). Write it first: one plain sentence of at most 15 words saying why this file changes and what you add or remove, as with Bash. It is shown to the user above the edit and removed before the tool runs. Example: {"description": "Fix clamp: it compared with lo where it needs hi.", "file_path": "...", ...}'
