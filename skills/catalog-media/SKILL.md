---
name: catalog-media
description: Ingest media into a brand's searchable library — photos, videos, audio from a folder, a Google Drive link, or a URL. One command probes, analyzes with Gemini (a scene-by-scene analysis of everything seen and heard, products, people, a transcript that local Whisper then corrects), embeds vectors for search, indexes, and pushes to R2. Use when onboarding a brand's media, adding new assets, emptying the brand's upload inbox, or when asked to ingest/catalog media.
---

# Catalog media

Each file becomes a record at `inputs/media/_catalog/json/<id>.json` (schema in
`tools/record-media.mjs`): its **analysis** (scene by scene with exact timestamps: what is seen, the
motion and transitions, what is heard and said — enough to recreate it), its **transcript** (Gemini's,
then Whisper's words and timings, the final one) and its **source**. Originals sit flat in
`inputs/media/<id>_<descriptor>.<ext>`; derivatives and `vectors.json` live in `_catalog/`. Search
it with **search-media**.

## Before starting

`inputs/products.json` and `_catalog/people.json` hold the names analysis matches and spells right in
transcripts (seeded by **research-brand**); missing files just mean nothing gets matched.

- `products.json`: one entry per SKU, `[{ name, aliases, look }]` — the canonical full name (no
  abbreviations), its short forms (`"ASG"`), and its look (packaging colors, wrapper text, shape,
  distinguishing marks). When a name is said differently than it's spelled, use
  `{ products, vocabulary }`, e.g. `"vocabulary": ["Acme (said \"Ack-mee\")"]`.
- `people.json`: `[{ name, description }]`, the description stable physical traits (age range,
  build, skin tone, hair, face).

## Ingest

```
node tools/catalog-media.mjs --brand workspaces/<WS>/<Brand> --source "<folder|Drive link|URL>"
```

Flags: `--help`. Re-running is safe: cataloged files and near-duplicate re-exports are skipped (each
logged with its reason), failed analyses retry, and a Drive folder pulls incrementally (**pull-media**),
so the same command can run on a schedule. Run it as one job with a generous timeout.

A folder can be anywhere (another drive too): its files are copied in and, with R2 keys, pushed, so
afterwards the user can delete it, and `node tools/sync-brand.mjs --free <brand dir>` deletes the local
copies the bucket holds (Studio streams them; tools fetch them back).

Pass `--generated` for what ADPK made, `--swipe` for ads or posts to replicate (**replicate-ad**;
kept out of footage searches). A folder **pull-media** downloaded into keeps each file's link
as its source.

Single steps: `analyze-media.mjs --media <…/media> --ids 00012 --force` (redo one),
`embed-media.mjs --media <…/media>` (after hand edits), `record-media.mjs --index <…/media>`.

## After ingest

- **People pass** — collect `unknown_people` across new records, cluster by description + source,
  and ask the user to name them once. Add each to `people.json`, move the entry from
  `unknown_people` to `people` in the matching records, then re-run `embed-media`.
- **Short SFX check** — analysis often names sound effects under ~2 s wrongly (a whoosh as a chime).
  Listen, fix the `analysis` by hand, then re-run `embed-media`.
- Browse in Studio's Media page (**open-studio**): `/<Workspace>/<Brand>/media`.
