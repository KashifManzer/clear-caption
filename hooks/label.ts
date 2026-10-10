const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// Model-written text is cut to one line and stripped of control characters (ESC, CR, BEL...)
// before it reaches the terminal.
const line = (s: string) => (s.split(/\r\n|\n|\r/)[0] ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()

// Plain-language caption for a tool call, or null to say nothing.
// Bash and Agent carry the model's `description` (a claim, not proof: the tool row keeps the real command).
// A subagent's own calls are skipped so they don't flood the main transcript.
export function captionOf(e: { tool: string; agentId?: string; description?: unknown }): string | null {
  if (e.agentId !== undefined || (e.tool !== 'Bash' && e.tool !== 'Agent')) {
    return null
  }

  return line(str(e.description)) || null
}
