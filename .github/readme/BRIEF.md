# README creative brief

The locked look for every README asset (banner, clip, feature media). Later runs start from this file: reuse the style
string, palette, typefaces and motion constraints, and read the rounds below before generating anything new.

## Evidence

- **Name:** "Prompt Optimizer", with the brand's own line "A little ghostwriter for your prompts." The ghost is a
  ghostwriter: someone who writes for you, unseen, while you keep the credit.
- **Job in the user's world:** a ghostwriter takes the note you scribbled in a hurry and hands the recipient a clean,
  clear card, while you keep your own note. In the plugin, the rewrite rides along as a hidden part of the message, the
  model reads it, and the chat keeps what you typed.
- **Voice:** friendly ("A little ghostwriter for your prompts."), careful ("The built-in prompts are careful."),
  unobtrusive ("Stays out of the way."). All three are quoted from the previous README.
- **Existing brand:** `assets/logo.png` (a white ghost waving on a lavender tile), the hero, judge and star
  illustrations in `assets/` (all since removed, see [Removed files](#removed-files)), and the README's diagram colors
  `#B1A4D6` and `#363262`. Measured from the images: lavender `#B1A4D6`, ghost white `#FDFCFB`, navy ink `#363262`,
  gold `#FECE6D`, cream card `#FEF7EC`. The old social preview used Nunito, which the video skills list as an overused
  default, so the new direction does not reuse it.
- **Visual references** (generation inputs live outside the repo, in the session's `readme-art/refs/`):
  - `ref-1-hero.png` (from `assets/hero.webp`): keep the lavender ground, the white ghost's proportions, the gold
    accents and the cream card.
  - `ref-2-logo.png` (from `assets/logo.png`): keep the ghost's face: navy oval eyes, a small smile, one raised arm.
  - `ref-3-tui-toast.png` and `ref-4-tui-dialog.png`: real OpenCode 1.18.33 TUI captures with this plugin loaded (a
    local mock model returned the rewrite documented in `prompts/default.md`). Keep the layouts of the success toast
    and the `/optimized` dialog, including its metadata line. Clip only; never passed to an image model.

## Directions shown

| | Metaphor | Medium + reference | brag tone |
|---|---|---|---|
| **A (picked)** | a needle-felted ghost ghostwriting at a tiny desk, turning a crumpled note into a crisp card | stop-motion needle-felt miniature, Aardman and Laika style | `default`, "cozy stop-motion short" |
| B | a ghost at a lamp-lit typewriter: scribble in, clean page out | 1970s 35mm film still, Kodak Portra 400 | `cinematic`, "quiet lamp-lit product film" |
| C | an exploded diagram: your note below, a translucent ghost layer above it | 1970s technical-manual risograph | `polished`, "editorial proof sheet" |

The owner picked A from three `z-image/turbo` previews.

## Locked direction (A)

- **Metaphor:** a small needle-felted white wool ghost with navy button eyes at a tiny wooden desk, smoothing a crumpled
  paper note into a crisp cream index card stitched with neat navy lines (lines, never letters).
- **Palette:** lavender `#B1A4D6` (ground), ghost white `#FDFCFB`, navy `#363262`, gold `#FECE6D`, cream `#FEF7EC`.
  Dark surfaces use the navy family (`#363262`, deepened to `#211E3D` for video backgrounds).
- **Light and texture:** soft window light from the left, visible wool fibers and paper grain, shallow depth of field.
- **Style string** (every Higgsfield prompt starts with it):

  > Stop-motion needle-felt miniature tabletop set, Aardman and Laika style, soft window light from the left, visible
  > wool fibers and paper grain, shallow depth of field, palette lavender #B1A4D6, ghost white #FDFCFB, navy #363262,
  > gold #FECE6D, cream #FEF7EC, calm uncluttered composition

  Light banner clause: "on a pale cream felt wall #FEF7EC".
- **Typefaces** (Google Fonts via Fontsource, OFL-1.1, embedded in the banner and the clip):
  - Display: **Fraunces** 700 (the name; soft, crafted serif). Fontsource id `fraunces`.
  - Text: **Instrument Sans** 400 and 600 (tagline, captions). Fontsource id `instrument-sans`.
  - Terminal UI in the clip: **JetBrains Mono** 400 and 700, so the recreated OpenCode screens read as a real terminal.
- **brag:** tone `default`, freeform "cozy stop-motion short"; landscape 1920x1080, 15-25 s.
- **Motion constraints (clip):**
  - Pieces settle like felt landing on a table: ease out, no bounce, no overshoot.
  - Paper slides and unfolds; it never morphs or spins.
  - At most one slow push-in per scene, never a whip.
- **One-line pitch:** "A felt ghost smooths your crumpled prompt into a crisp card."
- **Logo in the banner:** none. The art already shows the ghost, and a second ghost tile left of the name would push the
  text into the subject.

## Asset rounds

All banner art: endpoint `marketing-studio/image/flare`, `aspect_ratio` 21:9, `resolution` 2k, `quality` high. Every
candidate was composed with `banner.py` (Fraunces 700 name, Instrument Sans 400 tagline) and judged in Chromium at 830 px
on GitHub's page colors. `rsvg-convert` ignores the SVG's embedded fonts, so it can't be used for this check.

### banner-dark.svg

References: `ref-1-hero.png`, `ref-2-logo.png`.

| Round | Candidate | Prompt change | Slop score + tells | Hard fails | Verdict |
|---|---|---|---|---|---|
| 1 | c1 | (initial prompt) | 2: palette drift (green plant), wrong surface (window-light stripes behind the text; the title touches the ghost) | none | rejected |
| 1 | c2 | (initial prompt) | 2: palette drift (green plant), wrong surface (tagline hidden behind the paper ball) | banner layout (desk enters the left half) | rejected |
| 1 | c3 | (initial prompt) | 1: wrong surface (window-frame shadow behind the text) | banner layout (desk enters the left half) | rejected |
| 2 | c1 | subject clause re-composed (composition 5 vs color 2): props cut to one lamp, no plants; the scene small and entirely inside the right third; the left two thirds plain navy felt, no window shadows | 0 | none | accepted, request `174cdaaf-ff80-49bc-a4ab-b15b11925bf8` |
| 2 | c2 | same | 1: wrong surface (the title overlaps the paper ball) | none | rejected |
| 2 | c3 | same | 0 | banner layout (subject center below the middle third) | rejected |

Final prompt: the style string, then "a small needle-felted white wool ghost with navy button eyes at a tiny wooden desk,
smoothing a crumpled paper note into a crisp cream index card stitched with neat navy lines, only a small lavender felt
desk lamp beside it, no plants; the ghost, desk, lamp and papers are small and sit entirely inside the right third of
the frame, vertically centered; the left two thirds of the frame are plain empty deep navy #363262 felt wall with no
objects and no window shadows, dark background, take the palette, texture and mood from the reference images; do not
copy their layout or any text, no text, no letters".

Lesson: Fraunces 700 at banner.py's size needs about 63% of the width, so the subject has to stay in the right third.

### banner-light.svg

References: the accepted dark art (reference image 1), `ref-1-hero.png`, `ref-2-logo.png`.

| Round | Candidate | Prompt change | Slop score + tells | Hard fails | Verdict |
|---|---|---|---|---|---|
| 1 | c1 | (initial prompt: the dark prompt's subject clause plus "on a pale cream felt wall #FEF7EC", "the left 60% of the frame is plain empty pale cream #FEF7EC felt wall", "match the felt style, the ghost and the lighting of reference image 1") | 0 | none | accepted, request `950b4c1e-4d3d-4063-8830-c47c9f58f4b9` |
| 1 | c2 | same | 0 | none | passed, not picked (c1 mirrors the dark layout) |
| 1 | c3 | same | 0 | none | passed, not picked |

Tagline contrast on the composed light banner: 8.5:1 at its darkest point (`#3D4450` on `#F8EDE0`).

### social-preview.png

No new generation. `banner.py --width 1280 --height 640` sets the name at 128 px, which ran across the ghost, so the
preview is laid out in HTML from the accepted dark art with the same fonts (name 92 px on two lines, tagline 34 px) and
captured at 1280x640. The README doesn't use it, and on 2026-10-02 the repository had no custom social preview set; see
[Removed files](#removed-files).

### demo.mp4 and demo-poster.jpg (brag, full workflow)

Tone `default`, "cozy stop-motion short", 1920x1080, 30 fps, 22.4 s, music `happy-beats-business-moves-vol-9`
(bundled with brag) with quiet SFX. Built with Hyperframes 0.8.104; plan, brief and composition lived in the ignored
`brag-output/` (since removed). The hook and outro reuse the accepted dark banner art (cropped to 16:9); the middle
scenes recreate the real OpenCode TUI in the BRIEF palette. Both files were later removed; see
[Removed files](#removed-files).

| Round | Change | Gate result | Verdict |
|---|---|---|---|
| 1 | first build | `check`: one held `content_overlap` (the `/optimized` dialog over the transcript); snapshots: dialog cut through the chat bubble, toast flush against the footer, drafts scene top-heavy | rejected |
| 2 | dialog opens below the agent line, as in the real TUI; taller window body; drafts re-centered; the covered transcript marked as intentional modal layering | `check` passes (runtime, layout, motion with 9 assertions, contrast 52/52) | draft rendered |
| 3 | draft review (1 fps sheet, audio levels): accents peaked at -4 dB over a -13.7 dB bed; the drafts caption crossfaded over the previous caption | SFX lowered to peak -9 to -11 dB; scene 3 clears before the drafts caption | re-rendered |
| 4 | the crossfade fix left a background-only frame at 14.45 s | captions hand off without overlap and the window fades longer, so no frame is empty | accepted |

Final: `--quality high`, 7.8 MB after baking the poster as frame 0. Poster: the hook at 2.6 s; the README copy adds a
"Watch the 22-second demo" play pill.

### feature-1.gif, feature-2.gif, feature-3.gif

Cut from the clip with the README recipe (0.8 s hold on a settled frame, then the beat, 800 px, 128 colors):

| File | Beat | Window | fps | Size | First/last frame |
|---|---|---|---|---|---|
| feature-1.gif | the rewrite toast | 3.85-9.45 s, hold 8.8 s | 12 | 1.29 MB | settled toast both ends (diff 0.16) |
| feature-2.gif | `/optimized` dialog | 9.95-14.2 s, hold 13.2 s | 12 | 1.22 MB | settled dialog both ends (diff 0.08) |
| feature-3.gif | drafts and the judge | 14.67-18.4 s, hold 17.6 s | 10 | 1.88 MB | settled pick both ends (diff 0.12); 12 fps was 2.1 MB |

## Removed files

Removed on 2026-10-02 because nothing in the repo used them. The README plays the clip from github.com/user-attachments.
Git history keeps them.

| Path | Size | What it was |
|---|---|---|
| `.github/readme/demo.mp4` | 7.8 MB | the demo clip; the feature GIFs were cut from it |
| `.github/readme/demo-poster.jpg` | 132 KB | the clip's poster |
| `.github/readme/social-preview.png` | 713 KB | the 1280x640 social preview |
| `assets/logo.png`, `assets/logo.webp` | 224 KB, 7 KB | the old ghost logo |
| `assets/hero.webp`, `assets/judge.webp`, `assets/star.webp` | 39 KB, 11 KB, 11 KB | the hero, judge and star illustrations |
| `assets/social-preview.png` | 325 KB | the old social preview |

Restore one with `git checkout <commit>^ -- <path>`, where `<commit>` is the commit that removed it
(`git log -1 --format=%h --diff-filter=D -- <path>` prints it).
