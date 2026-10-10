const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const base = (p: unknown) => str(p).split('/').pop() ?? ''

// Plain-language label for a tool call, or null to leave the engine's own row.
// Bash uses the model's `description` (a claim, not proof); the rest derive from input.
export function labelFor(tool: string, input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>
  const name = base(i.file_path ?? i.notebook_path)
  let text = ''

  switch (tool) {
    case 'Bash':
    case 'Agent':
      text = str(i.description)
      break
    case 'Edit':
    case 'NotebookEdit':
      text = name && `Editing ${name}`
      break
    case 'Write':
      text = name && `Writing ${name}`
      break
    case 'Read':
      text = name && `Reading ${name}`
      break
  }

  return text.split('\n')[0] || null
}

// While a Bash call runs the engine's command box is not drawn yet, so the row shows the real
// command under the label: the model's description is a claim, the command is the fact.
export function commandOf(tool: string, input: unknown): string | null {
  const command = str(((input ?? {}) as Record<string, unknown>).command).split('\n')[0] ?? ''

  if (tool !== 'Bash' || command === '') {
    return null
  }

  return `$ ${command.length > 160 ? `${command.slice(0, 159)}…` : command}`
}

// The row is ours, so it must still say when a call failed or was cut short.
export function stateOf(p: { isErrored?: boolean; isInterrupted?: boolean }) {
  if (p.isInterrupted) {
    return { color: 'warning', note: ' (interrupted)' }
  }

  return { color: p.isErrored ? 'error' : undefined, note: p.isErrored ? ' (failed)' : '' }
}
