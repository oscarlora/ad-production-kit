---
name: pull-fonts
description: Capture a brand's fonts as one typography reference image so generated ads render the real fonts. Identify the site's fonts (headline/display, H1–H3, body, any additional) and headline case, render them all onto a single type sheet with tools/pull-fonts.py, record them in the brand's inputs/DESIGN.md, and attach it as a --ref on every generation. Runs as part of research; also use when an ad's type looks off-brand.
---

# Pull fonts

Generators follow a font shown in a reference image, so render the brand's fonts onto one type
sheet and attach it when generating. Build it during research, once the brand's fonts are known.

## Process

1. **Identify the real fonts — never guess from how the text looks.** Most reliable first:
   - **Computed styles.** In a browser: `getComputedStyle(document.querySelector('h1')).fontFamily`. Check `h1`, `h2`, `h3`, a body paragraph, and a button/label. The **first** name in each stack is the font; ignore generic fallbacks.
   - **The page CSS.** `@font-face { font-family; src: url(...) }`, Google Fonts `<link>` / `@import` families, which selectors use them, font CSS variables (`--font-heading`).
   - **The user**, if they know it.

   Capture per role: **headline / display**, **H1 / H2 / H3**, **body / UI**, and **any additional** font with where it's used. Note the **case** (`text-transform: uppercase` forces ALL CAPS) and weights. If a font can't be resolved, mark it **Unknown** and ask the user.
2. **Render one type sheet with every font:**
   ```
   python3 tools/pull-fonts.py --out "workspaces/<Workspace>/<Brand>/inputs/media/brand/type_sheet.png" \
     --font "Big Shoulders Display|700|H1 / headline|<a real hook>" \
     --font "Poppins|500|Body / UI|<a real support line>"
   ```
   One `--font` per font: `Source|weight|role|sample`; write the H1 `sample` in the brand's headline case. Source is a Google family name, a font-file URL, or a local `.ttf`/`.otf`. Defaults render white-on-dark; pass `--bg`/`--fg` hex to match the brand.
3. **Record in the brand's `inputs/DESIGN.md`**: each font in `typography` (role, family, weight);
   case and the sheet path under Typography. Font files not on Google Fonts (the brand's own, a `.ttf`, `.otf` or
   `.woff2` per weight) go in `inputs/media/brand/fonts/`; Studio's editor lists them in its font picker.

## Use in generation

- Hooks in the **H1** font and the brand's headline case, support copy in the **body** font; name the font in the prompt (**ideate-image-format**, Design).
- Attach `inputs/media/brand/type_sheet.png` as a `--ref` on every ad, marked in the prompt as a **FONT reference only — do not place it in the ad**.

## Font sources

**Never substitute a similar font.** The tool stops rather than swap in a wrong one.

- **Google Fonts** — pass the exact family name.
- **Self-hosted** — take the `.ttf`/`.otf` from the page's `@font-face` `src` (URL or a copy). `.woff2` can't be converted here — get the `.ttf`/`.otf` or desktop file instead.
- **Paid font, file in hand** — pass the local path.
- **Paid font you can't get** (Adobe Fonts, Typekit, Monotype) — **ask the user for the file.**
- **Last resort** — **ask the user for a screenshot** of the site showing all the fonts; save it to `inputs/media/brand/` and attach that as the `--ref` instead of the type sheet.
