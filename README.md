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
- **File edits (Edit and Write):** these calls carry no description, so Claude writes the reason itself.
  A line added to Claude's system prompt asks for one plain sentence right before each edit, one edit per reply, so it sits right above the edit row, like this one seen in testing:

  ```
  Fix math.js: add used minus, avg broke on an empty list, clamp ignored hi.
  ```

  It is Claude's own chat text, so it has no `clear-caption:` prefix and gives Claude's own reason.
  If an edit comes without its sentence, it is refused once with a note saying what to do; Claude then writes the sentence and sends the edit again.
  The same edit sent a second time always goes through, so this can't loop.
  A refusal shows as one red ✕ row with the note.
  Subagents' edits are never refused, and in testing a subagent did not get the system-prompt line.
  Costs to know:
  - Claude sends file edits one per reply instead of in a batch, which means more round trips.
    On small test tasks that cost 12-35% more; `/caption risky` or `off` turns it off.
  - A request to batch edits loses to this rule; Claude says so.
    Batching with one line per file was tried: when Claude batched, it wrote no lines (0 of 16 batched replies), even when refused.
  - The sentence ran 9-21 words in testing; 15 is asked for, not forced.
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
The edit refusals follow it at once, but the system-prompt line changes only from the next session.
So turning captions on mid-session can mean an edit gets refused once before Claude adjusts.

## Works with other mods

The caption is a transcript line, not a redrawn tool row.
A skin or any other mod that redraws tool rows can't hide it.
This has been checked live with the `skins` mod on.
The line is logged as soon as Claude has written the call, so it shows even when the call is then denied or refused.

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
  For Bash and Agent it is the `description` the model wrote; for an edit it is Claude's sentence.
  Either can be vague or wrong.
  That is why the real command and the diff stay in the row.
- **Where it lands.**
  Every caption sits right above its row, and an edit's sentence does too.
  With parallel calls, each caption sits above its own call.
  When Claude Code or a skin folds quick read-only calls (like `ls` and `wc`) into one row, the first caption sits above that row and the rest under it.
- **The row shows a moment later.**
  The caption needs the call's `description`, which arrives with the rest of its arguments, so a Bash or Agent row waits until Claude has written the whole call.
  In testing that was 0.4-0.8 seconds for Bash and 1.6 seconds for an Agent call with a short prompt; a longer prompt waits longer.
  The call itself runs no later: Claude Code runs a call only once all of its arguments are in.
- **The line names the mod.**
  Claude Code prefixes every mod's transcript line with the mod's name, so it reads `clear-caption: ...`.

## How it works

Three hooks in `hooks/register.tsx`.
A `turn.step` hook reads Claude's reply as it streams in: it holds each Bash or Agent call until its arguments are in, calls `$.ui.log` with the caption, then passes the call on unchanged.
A `prompt.compose` hook adds `EDIT_RULE` to Claude's system prompt.
A `tool.call` hook on Edit and Write reads the reply that holds the call (`$.session.messages`) and refuses it once if no text comes right before it.
`hooks/label.ts` holds the pure parts: `captionOf` picks a Bash or Agent caption, and `saysWhy` checks for the sentence.

## Develop

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```
