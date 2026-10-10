# clear-caption

A Claude Code mod that puts a plain-language caption on every tool call.

Raw commands like `find . -name "*.tmp" -exec rm {} \;` are hard to read at a glance.
clear-caption shows what the call does instead, and keeps the real command visible.

```
● Delete all .tmp files
  $ find . -name "*.tmp" -exec rm {} \;      <- only while the call runs
```

## What it does

- **Bash and Agent:** the row title is the call's own `description`.
- **Edit, NotebookEdit, Write, Read:** the row title is built from the file name, for example `Editing app.ts`.
- **While a Bash call runs:** the real command is shown dim under the caption.
  The engine's own command box is not drawn until the call ends, so this keeps the command visible.
- **Failed or interrupted calls:** the dot turns red with `(failed)`, or yellow with `(interrupted)`.
  The colors follow your theme.
- **Everything else:** tools without a caption are drawn exactly as the engine draws them.

It does not touch the spinner, the status line or the footer.

## Install

Type this at the prompt of a terminal session:

```
/plugin install clear-caption --marketplace KashifManzer/clear-caption
```

Answer `y` to add the marketplace, then pick a scope.

To try it from a local folder without installing:

```
claude --plugin-dir /path/to/clear-caption
```

## Read this before relying on it

- **Early-access API.**
  Mods use Claude Code's function hooks.
  The type file the engine writes says "EARLY ACCESS: this surface may change between releases without notice."
  A third-party write-up says function hooks are not shipped and sit behind a default-off flag.
  That write-up is unconfirmed, so check your own build.
  This mod was built and tested against Claude Code 2.1.296.
- **The caption is the model's claim.**
  Bash uses the `description` the model wrote.
  It can be vague or wrong, which is why the real command stays visible.
- **Folded rows.**
  Runs of reads and searches are folded into one count line by the engine, so those rows rarely show a caption.
- **Other mods.**
  Another mod that also draws the tool row (for example a skin) can compete with this one.
  Which one wins depends on load order, which was not verified.
- **Paths.**
  File names are split on `/`, so Windows paths show whole.
- **Not yet confirmed live.**
  The row caption and the failed state were seen in a real terminal session.
  The dim command line while a call runs is covered by tests but has not been confirmed on a real screen.

## How it works

One `ui.render` hook on `ToolUse` in `hooks/register.tsx`.
`hooks/label.ts` holds the pure functions that pick the caption, the running command and the state marker.

## Develop

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```

The tests draw the row on the terminal and desktop surfaces with the plugin test kit.
