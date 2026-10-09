<!-- Title: mod(<name>): <what>. One mod per pull request. -->

## What and why

<!-- What does this change, and what did you see before and after? A screenshot helps. -->

## Checklist

- [ ] `prompts/<mod>.md` exists and the code does what it says
- [ ] `npm run check -- mods/<mod>` is green (validate --strict, tsc, tests)
- [ ] UI tested on both terminal and desktop surfaces
- [ ] Guards fail closed; model calls are capped and say so in the README
- [ ] The README's "What it can touch" matches the "Can reach" badges
- [ ] My own code; no licensed assets; no Anthropic logos
- [ ] Ran `npm run catalog` and committed the generated files
