# Media assets

This folder holds images and recordings referenced by the top-level `README.md`.

Two screencasts are expected. **Neither is committed yet**, so the images render as
broken links — that's why this change lives on a branch and should not be merged to
`main` until both files exist here:

| File | Where it shows in the README | What it demonstrates |
|---|---|---|
| `list-dives.gif` | hero slot, under the badges | asking for recent dives and getting them back |
| `log-dive.gif` | "What you can do" section | logging a dive by describing it |

Both should be **~720px wide**, **~10–15s**, and **under ~5 MB**.

---

## ⚠️ Read first — privacy & safety

These clips go public on the README.

- **Use a test/throwaway PADI account** if you can — or pick dives whose details you're
  happy to publish. Avoid showing your email, real dive-site GPS, buddies' names, or
  anything in window chrome (notifications, other tabs, bookmarks).
- **`log-dive.gif` writes a real entry.** Recording it creates an actual dive in whatever
  account is connected. Plan to delete that dive afterward (see cleanup below).

---

## Clip 1 — `list-dives.gif` (recent dives)

**Beat sheet (~12s):**
1. Assistant already connected to the PADI MCP server (don't show setup).
2. Type: **`show my last 5 dives`**
3. Show the `padi_list_dives` tool call, then the answer — a tidy list with site, date, depth.
4. End the moment the list finishes rendering.

Keep the assistant zoomed to ~125–150% so the list is readable at 720px.

## Clip 2 — `log-dive.gif` (logging a dive)

**Beat sheet (~12–15s):**
1. Assistant connected, fresh prompt.
2. Type something natural, e.g.:
   **`log a dive: Blue Hole, today, 28 m, 42 min, nitrox 32`**
3. Show the `padi_create_dive` tool call and the assistant's confirmation (the new dive,
   with its id/date).
4. Optional payoff: follow with `show my last dive` so the viewer sees it really landed.

**Cleanup after recording** (so the demo dive isn't left in the logbook):
- Just ask the assistant: *"delete that dive I just logged"* (`padi_delete_dive`).
- Note the **delete guard**: `padi_delete_dive` refuses to remove anything that doesn't
  look like a test entry unless you explicitly override it. If it balks, either confirm
  the override when prompted, or delete the entry from the PADI app.

---

## Recording

On Windows, easiest options:

- **[ScreenToGif](https://www.screentogif.com/)** (free, recommended) — records a screen
  region straight to GIF and has a trim/frame editor. Set the capture width near 720px.
- **[ShareX](https://getsharex.com/)** (free) — region record to GIF or MP4.
- **Xbox Game Bar** (`Win`+`G`, built in) — records MP4; convert it below.

## Convert MP4 → GIF (if you recorded video)

Two-pass palette gives far better quality/size than a naive convert:

```bash
ffmpeg -i clip.mp4 -vf "fps=12,scale=720:-1:flags=lanczos,palettegen" palette.png
ffmpeg -i clip.mp4 -i palette.png -filter_complex "fps=12,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse" out.gif
```

Drop `fps` to 10 if the file is too big.

## Optimize

Aim for under ~5 MB so the README stays light:

```bash
gifsicle -O3 --lossy=80 out.gif -o out.gif
```

(Or [gifski](https://gifski.app) for high quality, or ezgif.com's optimizer in-browser.)

---

## Finishing up

Once **both** `list-dives.gif` and `log-dive.gif` are in this folder, commit them on this
branch, confirm the README renders both images locally, mark the PR ready, and merge.
