@AGENTS.md

# Working conventions for this repo

This project is built "vibecoding" style — the maintainer doesn't read every
diff line-by-line. These rules substitute for that missing manual review.
Treat them as load-bearing, not optional.

## Before merging to main, or after a large PR

- CI must be green: `.github/workflows/ci.yml` runs lint, typecheck, test,
  and build on every push/PR to `master`. Check the Checks tab, don't assume.
- Run `/code-review` (use `/code-review ultra` for a large or high-risk
  change) and address every finding before merging — this is the substitute
  for a human reviewer here. If a finding is deliberately left unfixed, say
  so explicitly rather than silently dropping it.
- `.github/pull_request_template.md` has the checklist — fill it out for
  real, don't just tick boxes.

## Testing

- Pure functions under `src/lib/` get Vitest unit tests (`*.test.ts`).
- React components (`src/components/*.tsx`) are not unit-tested — verify
  them live in the browser (dev server + real interaction) instead.
- Live-verification standard: when checking Web Audio / mixing / shuffle
  behavior, prove real automation fired — deck meters, Mixer panel values,
  actual playback-time advancement, or a direct API response. UI text
  alone claiming something worked is not proof.

## Local dev / shared database

- Local dev, Vercel preview, and production all share one Neon Postgres
  `DATABASE_URL`. Never run live tests against it with real user data.
- Use disposable `claude-*@local.test` accounts for any live testing, and
  clean them up via Prisma afterward.

## Deploy workflow pacing

- Commit, push, deploy (`vercel --prod`), and live sanity-check are four
  separate steps. Do only the one that was explicitly asked for — never
  chain them automatically.

## Licensing

- Never add essentia.js, or any other AGPL/GPL-licensed package, to
  `package.json`, import it under `src/` or `native/`, or commit its
  code/binaries — AGPL would legally obligate releasing this app's full
  source. It may only be used as an external, local comparison tool on a
  developer's own machine, never part of the build or shipped to users.

## Anthropic API usage

- Use current, non-deprecated model ids (e.g. `claude-sonnet-5`), not dated
  snapshot ids that can silently 404. If a model call keeps falling back,
  check production logs (`vercel logs`) before assuming it's a data issue.

## Git hooks / tooling

- `.husky/pre-push` runs lint + typecheck + test before every push. Don't
  bypass it with `--no-verify` without a concrete reason.
- `.nvmrc` pins the Node version (20) used locally and in CI — keep them
  in sync if it ever changes.

## Note on gating strictness

Branch protection on `master` is intentionally **not** enabled — direct
pushes still work. CI and the review checklist above are advisory gates,
not enforced ones. If that should change to a hard PR-required gate later,
ask before enabling it (it changes the push workflow for every change).
