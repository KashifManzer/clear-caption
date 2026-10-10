const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// Model-written text is cut to one line and stripped of control characters (ESC, CR, BEL...)
// before it reaches the terminal.
const line = (s: string) => (s.split(/\r\n|\n|\r/)[0] ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()

// ponytail: a short list of destructive spellings; others (rm --recursive, git push origin +main) slip through.
// Add a pattern when a real miss shows up.
const RISKY = /\brm\s+-[a-zA-Z]*[rR]|\bgit\s+push\b[^\n;&|]*\s(-f|--force)\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-zA-Z]*f|\bsudo\b|\bcurl\b[^|\n]*\|\s*(ba|z)?sh\b|\bchmod\s+-R\b/

// What `/caption` shows: every caption, only the ⚠ ones, or none.
export type Mode = 'all' | 'risky' | 'off'

export function modeOf(v: unknown): Mode | null {
  const mode = str(v).toLowerCase()
  return mode === 'all' || mode === 'risky' || mode === 'off' ? mode : null
}

// Plain-language caption for a tool call, or null to say nothing.
// Bash and Agent carry the model's `description` (a claim, not proof: the tool row keeps the real command),
// so a destructive command is marked whatever its description says.
// A subagent's own calls are skipped so they don't flood the main transcript.
export function captionOf(e: { tool: string; agentId?: string; description?: unknown; command?: unknown }, mode: Mode = 'all'): string | null {
  if (mode === 'off' || e.agentId !== undefined || (e.tool !== 'Bash' && e.tool !== 'Agent')) {
    return null
  }

  const caption = line(str(e.description))

  if (caption === '') {
    return null
  }

  if (e.tool === 'Bash' && RISKY.test(str(e.command))) {
    return `⚠ ${caption}`
  }

  return mode === 'all' ? caption : null
}
