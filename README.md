# TAP STUDIO — PRO

A polished variant of the **tap-to-reveal** image maker for X/Twitter — the trick where a picture looks like one thing in the timeline thumbnail and reveals the full image when you tap it.

Everything runs **locally in your browser**. No uploads, no servers, no tracking — your image never leaves your machine.

This is the same export engine as the original *image-reveal-studio*, rebuilt with a warmer, more refined UI and **real selection tools** (magic wand, quick select, object lasso) with add/subtract support.

## Live app

👉 **https://alexfacethemoon.github.io/tap-reveal-studio/**

## Three tools, one studio

The opening screen (`index.html`) lets you choose a tool:

- **Color Studio** (`studio.html`) — keeps the original colors; hidden areas become sparse interlaced pixels. This is the full painting tool described below.
- **Brush Dither** (`brush.html`) — black-and-white output using the exact 4×4 dither tile from real tap-me uploads; best for line art, sketches, and drawings. Adds a **Shadow** paint mode and a darkness threshold.
- **Sheer Shade** (`sheer.html`) — a photo retoucher: brush a see-through dark layer over skin so it reads like sheer tights/stockings (a *multiply* tint that keeps the skin's shape). Adjustable strength, tint, softness and sheen; exports a PNG.

## What it does (Color Studio)

1. Drop in a colored image (a PNG with the background already removed works best).
2. Pick a **paint mode** and mark the image:
   - **hidden** (pink) — becomes sparse interlaced pixels that vanish in the thumbnail
   - **visible** (blue) — stays visible even in the feed
   - **black** (green) — forced solid black in the output
   - **erase** — remove paint (right-click also erases)
3. Mark it with whatever tool fits:
   - **Brush** + shapes — paint freely
   - **Bucket** — flood-fill a region; it respects both your painted edges and the drawing's own outlines
   - **Magic wand** — select everything of a similar color from one tap
   - **Quick select** — drag like a brush; the selection grows through the similar-colored region
   - **Object lasso** — draw a *rough* loop around an object; it keeps just the object (uses transparency for cut-out PNGs, or eats the background inward for solid ones)
4. Hit **GENERATE PNG** — it bakes everything into a properly sized PNG-8 (auto-kept under ~700 KB / 2500 px).
5. Download and post it on X **from a desktop browser**.

## Selections

The three selection tools build a live selection (shown with a cyan tint + marching ants), which you then apply as a color from the **apply selection as…** card, or invert / deselect.

- **Shift** while selecting → **add** to the selection
- **Alt** while selecting → **subtract** from the selection
- On touch (no keyboard), use the **replace / add / subtract** segmented control instead.

## Why the constraints (PNG-8, file size, desktop upload)

These come from how X processes images and are unchanged from the original tool:

- **Hide then reveal** — X shows a shrunk-down preview in the feed and the full-resolution image only on tap. "Hidden" areas are stored as a sparse pixel pattern with transparent gaps that nearly vanish when shrunk.
- **PNG only** — the effect needs transparency + lossless pixels. JPG has neither; GIF/WebP get converted by X. An indexed **PNG-8** is the one format that survives.
- **Post from a computer** — the mobile apps re-encode uploads (often PNG→JPG) and destroy the transparency. A desktop-browser upload on x.com keeps the PNG intact.
- **File-size limit** — X leaves a PNG untouched only if it's small enough; over the limit it re-compresses to JPG. Export is auto-tuned to sit just under ~700 KB / 2500 px.

## Run it locally

Plain HTML/CSS/JS with **zero dependencies**. Either:

- Open `index.html` in any modern browser, **or**
- Serve the folder: `python -m http.server` then visit `http://localhost:8000`

> Needs a current browser (Canvas API + `CompressionStream`). Chrome, Edge, Firefox, Brave, and Safari all work.

## Publish on GitHub Pages

1. Create a repo and upload these files.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`, **Save**.
3. Wait ~1 minute; your tool is live at `https://YOUR-USERNAME.github.io/REPO/`.

## Files

| File | What it is |
|------|------------|
| `index.html` | the tool picker / landing screen |
| `studio.html` | Color Studio markup / layout (uses `style.css` + `app.js`) |
| `brush.html` | Brush Dither tool — self-contained (own styles + logic) |
| `sheer.html` | Sheer Shade retoucher — self-contained (own styles + logic) |
| `style.css`  | the warm dark theme (Color Studio) |
| `app.js`     | Color Studio logic — painting, bucket fill, selection tools, PNG-8 encoder |

## Credits

Idea by [@AlexFaceTheSun](https://x.com/alexfacethesun). Extra features by [Virtual](https://github.com/VirtualColor).

## License

MIT — see [LICENSE](LICENSE).
