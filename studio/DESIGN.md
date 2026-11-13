# Studio design

How Studio looks. Values live once, as variables in `:root` of `app/globals.css`; this file names
them and says how to use them. Sections follow the DESIGN.md format
(github.com/google-labs-code/design.md).

## Overview

A quiet tool for making and reviewing ads. The ads carry the color; the interface stays out of their
way: black, white and greys only, flat near-black surfaces, hairlines, one font (the look of the
Kino editor). Structure is felt rather than seen. Dense and calm, built for scanning many ads fast.

## Colors

- Surfaces: `--bg` every panel and page (one flat near-black, told apart by hairlines) · `--bg-subtle` viewer stage and empty frames · `--fill` fields, buttons, segmented-control
  tracks and hover · `--raised` the selected segment, rail page or step · `--fill-strong` timeline clips · `--fill-soft` hover on editable blocks · `--fill-strong` pressed · `--media-bg` behind media ·
  `--glass` the translucent dark of bars and controls floating over media
- Text: `--fg` primary (`--fg-hover` on the primary button) · `--muted-emphasis` body in tables and
  panels · `--muted` labels and meta · `--faint` placeholders, to-do steps, hollow dots, waveforms ·
  `--on-media` text and marks over media
- Lines: `--line` dividers and table rules · `--line-strong` hover borders and empty dots
- Status, only as 7px dots, never as fills: `--success` (white) Approved / done, `--info` (grey) Pending Review /
  current, `--warning` errors, the one color. In Progress is a hollow dot.
- Video stages sit on `--stage` (pure black); the editor letterboxes its preview on `--media-bg`. The only solid white fill is the primary button.

## Typography

- Inter only (`--font-sans`), weights 400, 500, 600. Body 14px, line height 1.55.
- Scale: `--text-xs` 12 labels, meta and dense marks (`.eyebrow`, timeline, key hints) · `--text-sm`
  13 controls, tables, panels · `--text-md` 14 body and prose (the page default) · `--text-lg` 16
  names · `--text-2xl` 24 page titles.
- 400 body · 500 labels, buttons, hooks · 600 headings and names. Headings track -0.015em to -0.02em.
- Tabular numbers for IDs, times and counts. Sentence case everywhere; slugs shown as words.
- Headings balance, paragraphs wrap pretty.

## Layout

- Pages pad by `--page-pad` (20px). Every brand page has a rail on the left as wide as the top bar is tall
  (`--bar-h`: the brand picker, then the pages as icons, no text) and one bar on top, both on `--bg-subtle` for the page's own controls: its count on the left, search centered, filters and actions
  on the right, each filter and the sort a dropdown led by a muted icon, the sort last; Board, Media and the Workflow
  list share this order (filters "Any …", sort Newest / Oldest). An ad's page puts back, ID and name, and the step tabs (names only) in that bar; its editor keeps the timeline (drag its top edge down to hide the tracks, simplified mode, or up to show them; a double click toggles)
  fixed at the bottom, with the preview and comments filling the space above (the comments under a bar like the top bar:
  the V1 · V2 switch, the guides and Export), all on `--bg`.
- The Board, the media library and the review link's page are one masonry grid (`lib/client/masonry.js`,
  `app/gallery.css`): 4 columns from 1200px, 3 from 900, 2 from 640, else 1; each item keeps its own shape. The Workflow list caps at 64rem, centered; prose caps
  at 46rem.
- Long text (prompts, persona detail, Meta copy) lives in the viewer's side panel, not in lists.
- Spacing steps of 2, 4, 6, 8, 10, 12, 16, 20, 24, 32px. Grids use `auto-fill`.
- Under 900px the editor and viewer narrow.

## Elevation & Depth

Mostly flat. Buttons and cards are drawn with `--shadow-border` (a hairline plus a trace of
shadow), which darkens on hover (`--shadow-border-hover`). Things floating over content — the
hover preview, the comment composer, the toast, play buttons — use `--shadow-float`.
A masked shape (the open step) uses `--shadow-shape`, a drop-shadow filter.
Media gets an inset hairline (`--media-outline`) so dark images keep their edge. Never a border
and a shadow on the same element.

## Shapes

`--radius-sm` (6px) for controls, thumbnails and small marks; `--radius` (10px) for cards, frames
and panels. A segmented track is 8px around 6px segments. Circles only for status dots, round play
and nav buttons. A dashed border means empty or a draft.

## Components

- **Button** `.btn`: `--fill` with a hairline; `--primary` white fill; `--mini` small;
  `--icon` square. Presses scale to 0.97. Toggle buttons use `aria-pressed`. Small controls are
  `--control-h-sm` (26px) tall, the rest `--control-h` (32px).
- **Segmented control** `.chips`: a `--fill` track; the selected segment is `--raised`. Used for clip takes and plan versions.
- **Rail** `.rail`: the current page's icon is `--raised` like a selected segment; the brand picker shows
  the brand's initials on `--fill` (workspace and brand on hover), one select over it, brands grouped by workspace.
- **Step bar** `.flow-steps`: the steps in one `--fill` track like a segmented control, a faint chevron between
  each; the open step is a `--raised` arrow with rounded corners pointing on (`--shadow-shape`); steps not started are
  `--faint`. No status dots.
- **Markdown editor** `.mde`: rendered markdown, edited as it reads: a clicked block or table cell becomes editable
  in place (bold, italic, links, lists; code, front matter and rules as raw text), framed by a hairline (a cell by a 1.5px `--fg` frame with `--radius-sm`,
  floating a little past its edges); a labeled line edits as its title and its text; only comments edit as raw text. Grips (`--faint`) sit in a margin outside the content and show on hover: left of a block; for a table, the
  hovered column's in a strip above the header, the hovered row's in a left gutter. Table columns wrap between
  8rem and 20rem (the row label 5–9rem) until a header's right edge is dragged (a 2px `--line-strong` line on hover,
  `col-resize` cursor; a double click resets), and a wider table scrolls sideways.
  A 2px `--fg` line marks where a drag drops; hovering a grip shades its row or column. A clicked grip selects its block, row or column (`--fill`; a drag across rows or Shift+click selects several) and opens a
  floating menu (`--shadow-float`), Delete last under a hairline. A script table ends with its word count and spoken time
  (estimated, or the voice take's own length once there is one), each after a muted icon; the hook in that sentence is
  a bold word that opens a list; one mini button on its
  right is the voice: Generate voice, then play / pause with the time ("0:12 / 2:09"), Regenerate voice once the script
  changes; no player controls. Selected text gets a floating Comment button; comments on the text list
  beside it past a full-height hairline, like the editor's, their quotes marked with `--fill-strong` and an underline;
  a panel icon in their head hides them (remembered), and a mini button at the top right brings them back.
- **Pages** `.pages-*`: the index is the Workflow list's rows (title, file, updated) under a group label; an open
  page puts every page in a `--bg-subtle` sidebar on its left (16rem; drag the hairline between them to resize it,
  a double click resets), sticky under the bar, its groups collapsible
  (Sources folders start closed), the open page raised like the rail's current icon; the page itself is the markdown
  editor below, its file and updated time as a muted line above with an Open file mini button.
- **Footage step** `.ft-*`: a `--fill` verdict box, then one row per scene: its clip (sticky, a dashed empty frame
  when missing) beside the scene name, a status dot once called, a ticked count, and its checks as shadow-bordered
  cards, then Approve / Reshoot mini buttons. A card is a check box beside what was asked, over its thread.
  Result icons (passed, the edit fixes it, reshoot) are `--muted`, never status colors.
- **Comments** `.ed__comments` (the editor's and a brief's): the count on the left, then Approve all and a plain
  archive icon (no background) that shows the approved ones, then one bordered card per comment (no fill): what it's
  on (its number and time, or the quote), its stage as a dot and word (Waiting, Working on it, Ready to review), and
  its rounds as a chat thread. A comment ready to review gets mini buttons on the right: Approve (primary), Watch
  change; Edit (while waiting) and Delete show on hover. Picked, it gets a dark ring and a reply field at its bottom, always
  open (the new comment's field and send arrow); a reply is the user's next bubble and reopens the comment. Hovered or
  pointed at from the timeline, a card lifts. The editor has no list: a comment is a small numbered dot on
  the timeline's ruler (grey, blue once seen, green when done; white when lit) and, when it marks a spot, a numbered circle there on the frame (while that moment shows); a click on
  either opens it in a popover there (the popover is its card: no border or ring of its own). A new comment without a spot (N) is written in a popover over the
  ruler, its round primary send arrow inside on the right, dimmed while empty. In Comment mode, dragging along the timeline's ruler
  picks a stretch for it: a faint `--fg` band with hairline edges over every track, its edges snapping
  to block edges (with Shift, as the playhead does, always to the nearest); a comment on a stretch draws a
  thin line along it through its dot. The ruler is the timeline's only head row, pinned on top as the tracks scroll under it.
- **Image card** `ImageCard` (every generated image a step shows: drafts, finals, sheets, looks): a storyboard frame's
  card in a grid: its name ("V8 · Piel de bebe", the file name on hover), the picture at its own ratio (click opens the
  viewer), the step's actions as mini buttons (a render's Approve, or the pressed Approved that moves it back to Drafts),
  then the generation details (model, settings, prompt, references) folded under Details.
- **Check box** `.check`: 18px, `--fill` with a hairline, `--radius-sm`; ticked, a `--fg` fill with a dark tick.
- **Thread** `.ft-thread`: chat messages, `--radius` with the tail corner `--radius-sm`: the AI and the agent on the
  left on `--bg-subtle`, the user on the right on `--fill-strong`; a `--faint` Comment link beside the latest.
- **Input / select** `.input` `.select` `.field`: 32px, 1px `--line` border that darkens on hover.
- **Font picker** `.font`: a field like a number's with a caret; it opens a floating list (`--shadow-float`) under it, or over it when there's more room: a search field, then Brand fonts (each with its use in `--muted` on the right) and Google Fonts, every name in its own font, the current one ticked, the highlighted one on `--fill`. Arrows or the moving pointer preview a font on the frame; Enter or a click keeps it, Esc or a click outside puts the first back.
- **Badge** `.badge`: status dot and word. **Pill mark** `.pill-mark`: a `--fill` tag.
- **Media card** (Board and Media): a media frame at the render's own ratio; name, ID or status show
  on hover over a dark fade. Media cards add select and action buttons on hover.
- **Media frame** `.media-frame`: media on `--media-bg` with the inset hairline; zooms 2% on hover.
- **Details** `.param`: side panels list everything as a small muted label over its value, grouped
  by space, never by dividers. Copy buttons show on hover.
- **Viewer** `.vw`: on `--bg-subtle`, three rows on the left, nothing floating over the media: a top row of
  buttons (Close, prev/next, the page's tools), the media (full height or full width), and a player's controls
  in a row under it, each row past a hairline; 420px panel on the right. Prev/next wrap around at the ends. An ad with several versions gets a
  segmented V1 · V2 … switch in the top bar (and Feed · Story when a version has both); its card says how many.
- **Player** `Player.js`: every video and audio uses Studio's own controls, never the browser's:
  play, the time and progress in one pill, mute, the guides and full screen, each its own round or pill control.
  Media blocks in a doc (`compact`) drop mute and the guides. In a viewer they sit in a
  row under the picture; on an inline video they are a row across its bottom edge, shown only while the pointer is on it. Clicking the picture plays or pauses.
  In the viewers: Space plays / pauses; once a video is started, ← / → step one frame (Shift: 5 s),
  otherwise they and ↑ / ↓ move between files. Library videos mark scene cuts on the progress bar
  (hover shows that moment's frame, time and scene) and show their transcript as captions (toggle);
  library audio shows its waveform and transcript (the word being said lit) above the controls.
  The guide button cycles overlays on any video or image, and on the editor's preview: the 4:5 and 1:1
  feed crops it can be cut to, then (9:16 only) Meta's Reels safe zone, then off.
- **Editing by hand** (the editor): the frame's tools sit under it, centered, icons in one segmented track with
  their keys in the tooltips: the two modes (Select, Comment with its open count), a hairline, then what acts at the
  playhead (Add text, Split), a hairline, the guides button. In the preview's top left corner a track holds the versions (V1, V2, …, when there are several); in its top right, Export (a download icon, its percent while it runs, then an icon that opens the video) and the gear for the edit's own settings. The mode switches what the frame does. **Select**: a click on the frame
  picks the top clip there and opens its inspector.
  **Comment**: the frame marks spots. The side always lists the comments. Picking a clip or a comment anywhere switches to
  its mode (V and C too). A click on nothing lets go of the picked block; Shift or ⌘ click picks several, as does a box dragged from an empty spot of the lanes (a faint `--fg` fill, hairline edge; letting go opens their settings over it); their settings show only what all of them have, "Mixed" (as a placeholder) where their values differ, and a change goes to all of them. A click picks a timeline block (a dark ring); its
  middle drags to move (onto another track's row, which tints, or the ruler's for a new top track; a video or sound in a run of touching clips, along its own track, carries its whole stretch of the edit, every track's layers over it, to the cut nearest the pointer, marked by a 2px `--fg` line, so lines swap places), its edges to trim (never over another clip on its track: it lands in the nearest free stretch; trimming a video or sound in a sequence moves what follows), snapping to block edges and the playhead; a picked clip is outlined on the frame and drags there
  to place it, its center snapping to the frame's and to other clips', a hairline guide showing each. The pointer over the timeline skims: the preview shows that moment under a faint `--muted` line, the playhead staying put (a click on an empty lane moves it there; between two blocks, where no video or sound plays on another track, it also picks that gap: a faint band with a small `--fg` Close gap pill, which, or Delete, takes the gap's time out of every track, and a trim that shortens a clip picks the gap it leaves). A track's name drags up or down to reorder the tracks, a 2px `--fg` line marking where it lands (between two tracks of a group it joins it; away from its group it leaves it); a click on it picks it (tinted `--fill`; Shift or ⌘: several), and with two or more picked a small `--fg` Group pill (⌘G) puts them in a group, ⇧⌘G takes them out. A group is a folder row over its tracks, which indent under it on a hairline guide: a chevron folds them into its row (their blocks shown small there), its eye and speaker act on all of them, its name drags the group and renames on a double click, and hovered it shows Ungroup; hovered, a bin at its end deletes the track; a double click types over the name. The timeline's top edge resizes it (a short grip bar in its middle stands out above the line), from its top row to all its tracks and never taller; a double click on it collapses it to its top row or opens it back. Pinch or ⌘-scroll zooms the timeline (+ / -, Shift+Z to fit) from the whole edit down to single frames, the ruler's labels and ticks following (a mark off a whole second reads as its frame, "12f"), which then scrolls under the track names.
  Every change shows at once and undoes with ⌘Z.
- **Inspector** `.insp`, in a popover `.pop`: settings show only when asked for, floating by what was clicked so the
  page stays the preview, its bar, the comments and the timeline. A click on a timeline block opens it over the block,
  growing upward; a click on a clip on the frame opens it beside the frame; the gear by Export opens the edit's own
  (frame size with ratio presets, background, frame rate, loudness) under itself. Esc, its ×, or a press outside
  closes it; a drag never opens it. A clip's has its name with Duplicate, Delete and Close, then one hairline-divided section per
  setting (Text, Timing, Layout, Style, Media, Volume), two fields a row; the optional ones (a text's Stroke,
  Background and Shadow; Fade, Animation, Transition) are a muted title with a + that adds them, then a − that takes
  them away. Style opens with its templates, a row of small black tiles each drawing "Aa" in a look (a picture's or shape's: a grey square with its corners, frame and shadow) (the brand's saved styles first, an × on hover removing one); a click applies one. A picked text whose look is new leads the row as a dashed Save tile. A color is a `.num` with its hex to type and a swatch that opens a small floating row: the brand's colors (from its DESIGN.md), then Custom for the browser's picker; the font is a `.num` that searches Google Fonts' families as it is typed. A number is one field `.num`, which drags sideways anywhere on it to change
  the value live (a click types it): its label, the value right-aligned, a faint unit; a keyframed one reads "keyed"; one off its default has its label in `--fg`, and a double click on the label resets it.
- **Source strip** `.trim` (a media clip's inspector, under Media): its whole source as two strips (frames, waveform), and the
  part it plays as a dark-edged selection over both to drag (edges, or the middle to slide); letting go saves and plays the new cut.
- **Notice** `.notice`: a `--fill` box in a side panel, for something to act on (an unnamed person to name).
- **Toast** `.toast`: near-black, bottom center, slides up 6px.
- **Focus**: always visible, never a ring outside the thing: its own edge darkens to `--muted` (a field's border; else a 1px `--focus-ring` where its border sits).

## Motion

Only to show a change of state; nothing animates on page load. Ease-out (`--ease-out`): `--dur`
150ms for color, shadow and hover reveals, `--dur-press` 120ms for presses, `--dur-enter` 180ms for
a panel or toast appearing and the media zoom. Animate transform and opacity, never `all`.
Everything stops under reduced motion.

## Do's and Don'ts

- Do use the `:root` variables; add one there before using a new value.
- Do keep color for status; show selection with the raised segment.
- Do put long text in the viewer panel and keep lists to one line per field.
- Don't add gradients, tints, colored icon backgrounds or a second accent.
- Don't add a second font, a third radius, or a border plus a shadow.
- Don't let the interface compete with the ads: no decoration, icons 13–16px and muted.
