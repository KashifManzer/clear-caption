# clear-caption

A Claude Code mod that puts a plain-language caption on each shell command and subagent.

Raw commands like `find . -name "*.tmp" -exec rm {} \;` are hard to read at a glance.
clear-caption adds one dim line that says what the call does.
The tool row and its real command stay exactly as they were.

```
● Bash(find . -name "*.tmp" -exec rm {} \;)
  ⎿ (output)
● clear-caption: Delete all .tmp files
```

## What it does

- **Bash and Agent calls:** before the call runs, a dim transcript line shows the call's own `description`.
- **Destructive commands:** the caption starts with `⚠` when the command:
  - deletes recursively (`rm -r`, `rm --recursive`) outside temp folders;
  - throws away git work (`git reset --hard`, `git clean -f`, `git checkout -- …` or `git checkout .`, `git restore` without `--staged`, `git branch -D`, `git stash drop` or `git stash clear`);
  - force-pushes;
  - deletes by search (`find … -delete`);
  - uses `sudo`, pipes `curl` into a shell, or runs `chmod -R`.

  It checks the real command, so the mark shows even when the description sounds harmless.

  Deleting only under `/tmp`, `/private/tmp`, `/var/folders`, `$TMPDIR` or a `scratchpad` folder is not marked.
  That includes a `$VAR` that the same command sets to one of those, such as `S=/tmp/run; rm -rf $S`.

  It is a short list of common spellings, not a guarantee. Text inside quotes or heredocs is read as a command too.
- **No description:** no line.
- **Subagents' own calls:** no line, so a busy subagent doesn't flood the transcript.
- **Everything else:** untouched. The tool row, its command, and its failed or interrupted state are drawn by Claude Code or by your skin, as usual.

## Turn it down

One line per call can be a lot. Pick how much you see:

```
/caption risky   only ⚠ captions, for destructive commands
/caption off     no captions
/caption all     every caption (the default)
/caption         show the current setting
```

The choice is saved and applies to every session.

## Works with other mods

The caption is a transcript line, not a redrawn tool row.
A skin or any other mod that redraws tool rows can't hide it.
This has been checked live with the `skins` mod on.
Only a mod that refuses the call before it runs can stop the line, and then the call doesn't run either.

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
  This mod was built and tested against Claude Code 2.1.296.
- **The caption is the model's claim.**
  It is the `description` the model wrote, which can be vague or wrong.
  That is why the real command stays in the row.
- **Where it lands.**
  The line is drawn under its call's output, not above the row.
  With parallel calls, each caption sits under its own call.
- **The line names the mod.**
  Claude Code prefixes every mod's transcript line with the mod's name, so it reads `clear-caption: ...`.

## How it works

One `tool.call` hook in `hooks/register.tsx`.
It calls `$.ui.log` with the caption and then lets the call run unchanged.
`hooks/label.ts` holds `captionOf`, the pure function that picks the caption.

## Develop

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```
