# clear-caption

A Claude Code mod that puts a plain-language caption on each shell command, subagent and file edit.

Raw commands like `find . -name "*.tmp" -exec rm {} \;` are hard to read at a glance.
clear-caption adds one dim line that says what the call does.
The tool row and its real command stay exactly as they were.

```
● clear-caption: Delete all .tmp files
● Bash(find . -name "*.tmp" -exec rm {} \;)
  ⎿ (output)
```

## What it does

- **Bash and Agent calls:** a dim transcript line right above the call's row shows the call's own `description`.
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
- **File edits (Edit and Write):** the same kind of line, right above each edit row.
  These tools have no `description` argument, so the mod adds a note to their tool description asking Claude to pass one anyway: one plain sentence saying why the file changes.
  The mod takes that argument out again before Claude Code checks the call, so the edit runs as usual and the approval dialog shows a clean diff.
  A line seen in testing:

  ```
  ● clear-caption: Fix clamp: Math.min should cap at hi, not lo.
  ● Update(math.js)
  ```

  Claude can still batch several edits in one reply; each gets its own line above its own row.
  In testing, 57 of 57 edits got their line, over Opus, Sonnet and Haiku, including a prompt that said "batch all file edits into one reply and write no commentary at all".
  On Opus test tasks, runs with and without the note both averaged $0.257; the note added about 3% more output tokens.
  An edit that comes without the sentence just gets no line; nothing is refused.
- **No description:** no line.
- **Subagents' own calls:** no line, so a busy subagent doesn't flood the transcript.
- **Everything else:** untouched. The tool row, its command, and its failed or interrupted state are drawn by Claude Code or by your skin, as usual.

## Turn it down

One line per call can be a lot. Pick how much you see:

```
/caption risky   only ⚠ captions, for destructive commands (Claude is not asked about edits)
/caption off     no captions
/caption all     every caption (the default)
/caption         show the current setting
```

The choice is saved and applies to every session.
Bash and Agent lines follow it at once, and so does turning edit lines down.
Turning edit lines on (`/caption all`) needs `/clear` or a new session: Claude Code keeps a session's tool descriptions as they were when it started, so the note to Claude changes only then.
A resumed session (`--resume`) keeps the note it had.

## Works with other mods

The caption is a transcript line, not a redrawn tool row.
A skin or any other mod that redraws tool rows can't hide it.
This has been checked live with the `skins` mod drawing the rows (the `noir` skin), batched edits included.
The line is logged as soon as Claude has written the call, so it shows even when the call is then denied.

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
  It is the `description` the model wrote, for an edit as for Bash and Agent.
  It can be vague or wrong: in testing, Haiku once said "four modules" for three.
  That is why the real command and the diff stay in the row.
- **Where it lands.**
  Every caption sits right above its row.
  With parallel calls or batched edits, each caption sits above its own call.
  When Claude Code or a skin folds quick read-only calls (like `ls` and `wc`) into one row, the first caption sits above that row and the rest under it.
- **The row shows a moment later.**
  The caption needs the call's `description`, which arrives with the rest of its arguments, so a Bash or Agent row waits until Claude has written the whole call.
  In testing that was 0.4-0.8 seconds for Bash and 1.6 seconds for an Agent call with a short prompt; a longer prompt waits longer.
  Edit and Write rows add no wait: Claude Code draws them only once their arguments are in anyway.
  The call itself runs no later: Claude Code runs a call only once all of its arguments are in.
- **The extra argument can spill over.**
  Claude was asked for `description` only on Edit and Write, but twice in about 250 Read calls in testing (both Haiku) it added one to Read too.
  Read ignores it and ran normally.
  Grep and Glob, which a default session doesn't have, refuse it when they are turned on, so such a call would fail once.
- **Removing the mod mid-session.**
  The note to Claude stays in that session after the mod is turned off or removed, and nothing takes the extra argument out any more.
  In testing, the next edit then failed once with "An unexpected parameter `description` was provided", Claude sent it again without it, and the following edits worked.
  A new session, or `/clear`, starts clean.
- **The line names the mod.**
  Claude Code prefixes every mod's transcript line with the mod's name, so it reads `clear-caption: ...`.

## How it works

Two hooks in `hooks/register.tsx` do the work.
A `tool.describe` hook adds `EDIT_ASK` to the Edit and Write tool descriptions under `/caption all`.
A `turn.step` hook reads Claude's reply as it streams in: it holds each Edit or Write call, and each Bash or Agent call that may get a line, until its arguments are in, calls `$.ui.log` with the caption, then passes the call on.
Bash and Agent calls pass on unchanged; an edit passes on without its `description`, in every mode and in subagents, since Claude Code refuses arguments it doesn't know.
`hooks/label.ts` holds the pure parts: `captionOf` picks the caption, and `EDIT_ASK` is the note to Claude.

## Develop

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```
