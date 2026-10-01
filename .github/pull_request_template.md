## What changed and why

<!-- One or two sentences. Not "what" if the diff already shows it — "why". -->

## Review gate (required before merging)

- [ ] CI is green (lint, typecheck, test, build — see the Checks tab)
- [ ] Ran `/code-review` (use `/code-review ultra` for a large or high-risk PR) and addressed or consciously dismissed every finding
- [ ] If this touches UI/frontend: verified live in the browser (not just type/test-checked) — golden path and edge cases
- [ ] If this touches a Web Audio / mixing / shuffle path: verified with real automation proof (deck meters, Mixer values, actual playback advancement), not just UI text

## Risk

<!-- Anything hard to reverse, any DB/schema change, anything that touches prod config or the shared Neon DB. -->
