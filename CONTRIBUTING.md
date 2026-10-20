# Contributing

Thanks for helping make Claude Code easier to read.
Small, focused changes are the easiest to review and the quickest to land.

## Ways to help

- **Report a bug.** Open an issue with what you ran, what you saw and what you expected.
- **Suggest a risky command.** Missed a command that should get a `⚠`, or got one it shouldn't? Open an issue with the exact command.
- **Send a fix.** For anything bigger than a small fix, open an issue first so we can agree on the approach.

## Set up

You need [Claude Code](https://code.claude.com/docs) installed.

```
git clone https://github.com/KashifManzer/clear-caption.git
cd clear-caption
claude --plugin-dir .
```

That starts a session with your local copy loaded.
Run a few commands and edits to see your change live.

## Where things live

| File | What it does |
| --- | --- |
| `hooks/label.ts` | Pure logic: picks the caption, spots risky commands, holds the note to Claude |
| `hooks/register.tsx` | The hooks and the `/caption` command |
| `hooks/label.test.ts` | Tests for both |

## Before you open a PR

Run both checks and make sure they pass:

```
claude plugin validate .
claude plugin test .
```

- Add a test for every change in behavior. A new risky command needs a case that gets the `⚠` and a close look-alike that doesn't.
- Update the README if users will notice the change.
- Keep the diff small and the code plain. No new dependencies unless there's no other way.

## Commits and PRs

- Write commit messages as a short sentence in plain words, like `Mark git clean -f as risky`.
- One topic per PR. Fill in the PR template.
- Don't edit the version in `.claude-plugin/plugin.json`. The maintainer bumps it on release.

## Code of Conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
