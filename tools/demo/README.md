# README demo animation

Generates `docs/assets/demo.gif` and `docs/assets/demo.svg` — the animated
demo embedded at the top of the repository README.

## Honesty statement

Every frame is derived from `tools/demo/capture.json`, which is produced by a
**real run** of the committed
[`examples/patterns/research-diamond/`](../../examples/patterns/research-diamond/)
pattern bundle. Nothing on screen is hand-animated or invented:

- The node states and the journal panel replay the actual committed event
  triples `[sequence, type, nodeId]` from the durable run's protected journal.
- The concurrency indicator reflects which source nodes have a committed
  `NodeStarted` without a committed `NodeSucceeded` at that point in the
  sequence — the three sources genuinely overlap (the bundle's overlap gate
  fails the capture otherwise).
- Every number on the closing card (events committed, max observed
  concurrency, protected payload blobs, plaintext leaks, claim counts, total
  attempts, graph hash) is read from `capture.json` at render time.

The renderer is deterministic: no clock, no randomness, no network, no screen
recording. Re-running the pipeline reproduces the same animation.

## Regenerate

1. Build the workspace packages if `packages/*/dist` is missing
   (`corepack pnpm --filter <package> run build`).

2. Capture ground truth — runs the research-diamond graph natively (with the
   overlap gate) and durably (with mandatory payload protection), then dumps
   the committed event sequence and run results:

   ```bash
   node tools/demo/capture.mjs
   ```

3. Render both assets from the capture (needs Python 3 with Pillow; use a
   throwaway virtualenv — Pillow is intentionally not a project dependency):

   ```bash
   python tools/demo/render.py            # writes docs/assets/demo.{gif,svg}
   python tools/demo/render.py --previews /tmp/demo-previews   # + PNG frames
   ```

The GIF is the primary embed (universally supported); the SVG is the same
storyboard as a self-contained SMIL animation, which renders crisper where
supported. Both use the palette of `docs/assets/graph-engineering-hero.svg`.
