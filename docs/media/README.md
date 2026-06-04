# Media assets

This folder holds images and recordings referenced by the top-level `README.md`.

## `demo.gif` (expected)

The README references `docs/media/demo.gif` — a short (~15 second) screencast that
shows the project in action. **It is not committed yet.** Until it exists, the
image will render as a broken link, which is why this change lives on a branch and
should not be merged to `main` until `demo.gif` is added here.

### Suggested clip

A ~15s capture of asking an AI assistant (e.g. Claude Desktop or Cursor) a question
and getting a real answer from your logbook, such as:

> *"how many dives do I have?"*

…and the assistant replying with the count pulled live from PADI.

### Tips

- Keep it short and loopable (10–20s).
- Target ~720px wide to match the README `<img>` width.
- Optimize the file size (e.g. `gifsicle -O3`) so the README stays light.
- Once `demo.gif` is in this folder, merge the branch.
