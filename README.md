# BurnMyTongue — Virtual Book

A private, book-like reading experience built with **HTML5, CSS3 and vanilla JavaScript
only**. No frameworks, no libraries, no build step, no package manager.

The reader sees a closed hardcover, opens it, reads a two-page spread, turns leaves one
at a time, and closes it at the end. The transition between pages is a real 3D leaf
rotation, never a fade between screens.

---

## 1. Technologies

| Concern | Choice |
| --- | --- |
| Markup | HTML5, semantic, one document |
| Styling | CSS3 — custom properties, 3D transforms, `clip-path`, `svh`/`dvh`, container-free media queries |
| Behaviour | ES5-compatible vanilla JavaScript, no modules, no bundler |
| Type | Cormorant Garamond + EB Garamond from Google Fonts, with a full local serif fallback |
| Dependencies | None. Zero runtime libraries. |

The page loads its chapters with `fetch()`, so it needs to be served over HTTP rather than
opened from `file://`. See [How to run](#6-how-to-run).

## 2. Structure

```
BurnMyTongue/
│
├── index.html                  the book shell: cover, spine, leaf stage, controls
├── README.md                   this file
│
├── assets/
│   └── music/
│       ├── background.mp3      optional background music (supply your own)
│       └── README.md           what to put here
│
├── css/
│   ├── style.css               reset, design tokens, typography, controls, notices
│   ├── book.css                the physical object: cover, spine, paper, leaves, depth
│   ├── pages.css               what lives on the paper: chapters, quotes, folios
│   ├── animations.css          keyframes: opening, closing, turning, shadows
│   └── responsive.css          phone, tablet, laptop, desktop, short viewports
│
├── js/
│   ├── main.js                 bootstrap and module wiring
│   ├── book.js                 the state model — the single source of truth
│   ├── navigation.js           reading controls, keyboard, swipe, announcements
│   ├── animations.js           reduced-motion queries and motion helpers
│   └── music.js                optional music, user-gesture only
│
└── pages/
    ├── arisa.html              chapter one — the past
    ├── sorry.html              chapter two — apology and confession
    ├── thankyou.html           chapter three — gratitude, two vow pages
    ├── acceptance.html         chapter four — letting go, finale page
    └── final.html              chapter five — the last page, THE END
```

There are no image or texture files. Paper, cover, spine, page edges and depth are all
produced with CSS gradients and shadows. Every chapter is text only.

## 3. What each file does

### `index.html`

The only HTML document. It is the book object: front board, back board, spine, the stage
that holds the leaves, the reading controls, and the music control. It contains **no
chapter content**.

The reading order is declared once, here, as a manifest on the book element:

```html
<div class="book" data-chapters="
  pages/arisa.html|The First Love I Never Got to Forget;
  pages/sorry.html|I&rsquo;m Sorry;
  pages/thankyou.html|Thank You;
  pages/acceptance.html|Acceptance;
  pages/final.html|The Last Page
"></div>
```

Format is `path|Title` per entry, `;` separated. Reorder the whole book by editing this
attribute. CSS is loaded `style → book → pages → animations → responsive`; scripts are
loaded `book → animations → navigation → music → main`.

### `css/style.css`

The foundation. Reset, design tokens on `:root` (palette, type, page ratio, the `--chrome`
budget the book leaves for the control bar), the type scale, button styling, the control
bar, and the error notice. Nothing book-specific or page-specific lives here.

### `css/book.css`

The physical object. The 3D context, boards, spine, page block edges, the paper surfaces,
the leaf, and the cast shadow. Also contains the full paint-order ladder (`z-index` bands
plus `translateZ` depths) that keeps turned leaves, boards and pages in the right order.

### `css/pages.css`

Everything inside a page: chapter opener, running head, body copy, drop cap, pull quote,
promise lists, signature, end matter, and folios. This is the file to edit when the
writing should look different.

### `css/animations.css`

Every `@keyframes` block, the state classes that drive them, and the
`prefers-reduced-motion` overrides.

### `css/responsive.css`

Breakpoints, loaded last so it wins on equal specificity. Also owns the `--chrome` budget
per breakpoint, which is what guarantees the book always fits the viewport.

### `js/main.js`

Entry point, and the only module aware of all the others. Reads the manifest, fetches the
chapters, parses the fragments, constructs the modules, wires them, and owns the
error notice. Holds no behaviour of its own.

### `js/book.js`

The state model and the only place state lives:

```js
{ isOpen, isAnimating, index, total, direction, layout }
```

Builds the leaves, tracks which pages are visible, drives the turn, and broadcasts
`book:progress`, `book:opened`, `book:closed`, `book:turned`, `book:opening`,
`book:closing` and `book:layout`.

### `js/navigation.js`

Everything the reader touches: open, close, previous, next, the chapter label, the folio
readout, the reading ribbon, arrow keys, Escape, and swipe. It calls a `book` method to
change state and re-reads state from the events to update the UI, so it never mutates
state directly.

The ribbon is also a page scrubber. It is a `role="slider"` over the book's spreads:
click anywhere to jump, drag the handle with pointer events to scrub, and use the arrow,
Home and End keys when focused. Its value comes from `Book._progress()` and it navigates
through `book.jumpTo()`, so it can never disagree with the page. The visible line is still
2px; the element is padded to a 32px hit area and carries `touch-action: none` so a finger
can drag it without scrolling the page. `Book.jumpTo()` lands on the spread directly rather
than walking there turn by turn, which is what stops a long drag from queueing dozens of
animations — it retires any turn already in flight, then sets the index. A one-page jump
still animates, because that is the reader pressing Next.

### `js/animations.js`

The reduced-motion query and small motion helpers. It decides *how* a turn resolves:
`animationend` in normal mode, an immediate settle under reduced motion.

### `js/music.js`

Isolated and optional. `play`, `pause`, `toggle`, `toggleMute`, remembers the reader's
choice in `localStorage`, hides its controls when the file is absent, and **never starts
playback on load**.

### `pages/*.html`

One text fragment per chapter. No `<html>`, `<head>`, `<body>`, `<link>`, `<script>`,
navigation or audio. A fragment holds a title page and then as many text pages as the
chapter needs:

- `.chapter--opener` — the chapter number, title and epigraph. Exactly one, first.
  `--opener--quiet` and `--opener--warm` are the Chapter Two and Chapter Three variants.
- `.chapter--page` — a numbered section, e.g. `<span class="section__num">Page One</span>`.
  Chapter Two labels its sections `Section One` … `Section Eight`; Chapter Three uses
  `Section One` … `Section Eleven`.
- `.chapter--page--cont` — a continuation of the section above it, same typography, no
  section number. Used only where a section runs longer than one printed page.
- `.chapter--closing` — a quiet end-of-chapter page. In `sorry.html` and `thankyou.html`;
  `--closing--warm` is the gentler Chapter Three variant.
- `.chapter--end` — only in `final.html`. `--end--finale` is the closing page carrying
  nothing but `THE END`.

Writing conventions inside a page: `.opener-p` for the first paragraph, `.beat` for a
short dramatic aside, `.speech` for the quoted speech, `.laugh` for the laughter lines,
`.pullquote` for a set-apart line, `.mark` for a single emphasised phrase, `.tl` to stop
the browser hyphenating a Bisaya/English phrase, and `.chapter__close` for the
end-of-chapter marker.

Chapter Two and Chapter Three also use page-level treatments defined once in `pages.css`:
`.quote-page` for an epigraph page, `.confession` for the lines a chapter turns on, and
`.chapter--page--confession` / `.chapter--page--one-line`, which give those pages more air
than a text page needs. `.chapter--page--vow` with `.vow` centres a single large line and
leaves the rest of the page empty; Chapter Four uses it for its two closing lines.

Chapter Four is the only chapter whose tone shifts as it turns. Its opening pages carry
`.chapter--page--dim` and its closing pages `.chapter--page--bright`, which shift the paper
and ink a few degrees inside the existing palette — acceptance starts dark and ends light
without leaving the book. `.choices` sets a group of statements as a list rather than prose,
and `.vow--finale` fades its line in over 1.6s (collapsed to an instant appearance under
`prefers-reduced-motion`).

Chapter Five carries the whole book to its last page. `.chapter--page--lastwords` trims the
generous vertical centring on the page that holds the closing sentence and the signature,
because that page also has a running head and a section title; `.signature--finale` centres
`— Kent` at signature size instead of in the margin; and `.end__mark--finale` sets
`THE END` in wide-tracked small capitals that arrive after a long fade, so the reader sits
with an empty page before the word appears.

## 4. The last page

The book ends on a spread, not a screen. Turning to the final spread puts the last words on
the verso and `THE END` on the recto, and the page after that does not exist — the reader
never turns past the closing page. Next on that spread is not a dead button: its label
becomes `Close the book` and it closes the book, which is how this project returns to
`index.html`. `ArrowRight` and `Spacebar` do the same.

These files hold the writing. They are the only ones you edit to change what the book says.

## 4. How the book works

**The leaf model.** A real book is a stack of leaves, each with a front and a back. The
digital book does the same thing. Each `.leaf` holds a front and a back face, both
`backface-visibility: hidden`, so a face is only visible when it is turned toward the
reader. Turning a leaf rotates it 180° about the spine, which carries the outgoing page
away and brings the incoming page into view as it lands.

**One flat page list.** Every chapter is flattened into a single ordered list of pages
(`Book.prototype._flatten`), because the book turns *pages*, not chapters. Spread *k* shows
pages `2k` and `2k+1`; leaf *k* carries the recto and verso of that pair. A section longer
than one printed page simply becomes a `.chapter--page` followed by a
`.chapter--page--cont`. The current book is 282 pages across 141 leaves, so 140 turns and 283
printed numbers — folio 1 is the inside front cover, and the last spread carries the end page.

**Opening.** The front board lifts, arcs over on a `translateZ` rise, and settles to the
left, revealing the first spread. Reading controls fade in only once it is open.

**Closing.** The exact reverse, driven by the same keyframes, returning to the closed
cover.

**Page turn.** The turning leaf rotates through 180° with a cast shadow beneath it that
peaks at the midpoint, a light sweep across the bending face, and a slight lift off the
stack. The content underneath is a real page the whole time, so it is revealed rather than
faded in. Input is locked for the duration, so a fast double-click cannot desynchronise
the book.

**Single-page mode.** Below 48em, and on tablets in portrait, the facing page is hidden and
one page is shown at a time. The leaf becomes the page: it swings off to the left, where
the stage clips it, revealing the next page underneath. The cover has nowhere to fall, so
it lifts and fades instead.

**Stacking.** Paint order is explicit. Unturned leaves are ordered so the first unread
leaf is on top; turned leaves stack on the left with the most recent on top; the turning
leaf is lifted above everything; the open front cover sits below the page stack, and the
gutter shadow sits above the open cover but below the paper, so the cover board never shows
through the gap at the spine. Both `z-index` and `translateZ` are used because CSS cannot
sort coplanar 3D elements from geometry alone.

## 5. Sizing and responsiveness

The book never grows taller than the space it has. `--chrome` declares how much vertical
space the stage padding and control bar need, and every size formula subtracts it:

```css
--page-h: min(700px, calc(100dvh - var(--chrome)), calc((100vw - 6rem) / 1.47));
```

| Viewport | Layout |
| --- | --- |
| Desktop, laptop, tablet landscape | Two-page spread, realistic perspective |
| Tablet portrait, phones | Single page, one chapter page at a time |
| Small phones | Single page, reduced margins and type |
| Landscape phone, shallow window | Page shrinks to the short axis, chrome trimmed |
| Touch devices | Large targets, no hover-only affordances |

`svh`/`dvh` are used with a `100vh`-safe fallback, and `env(safe-area-inset-*)` pads the
control bar for notched devices. Vertical and horizontal overflow are both clipped.

## 6. How to run

Chapters are loaded with `fetch()`, which browsers block on `file://`. Serve the folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`. Any static host works equally well, including GitHub
Pages, with no build step. Opening `index.html` by double-clicking shows a notice with
this command rather than a blank page.

## 7. Reading controls

| Input | Action |
| --- | --- |
| Click the cover, or **Open book**, or `Enter` | Open the book |
| **Next**, or `→` | Turn forward |
| **Previous**, or `←` | Turn back |
| Swipe left / right | Turn forward / back |
| **Close book**, or `Escape` | Close the book |
| Music and mute controls | Play, pause, mute |

Previous and next disable themselves at the ends of the book, so navigation outside the
available pages is structurally impossible rather than merely guarded.

**Swipe versus scroll.** A swipe only turns a page when the content is not scrollable in
that direction. If a page is long enough to scroll, swiping scrolls it until it reaches
the edge, and only then turns the page. Reading controls are real `<button>` elements with
labels, focus states and an `aria-live` region that announces each chapter and folio.

**Reduced motion.** Under `prefers-reduced-motion: reduce` the rotation is replaced by an
instant settle — the leaf lands directly in the position it was turning to. The state
machine, events, controls and content are identical, so the book remains fully readable and
only the motion changes.

## 8. Customising

| To change | Edit |
| --- | --- |
| The writing | The `pages/*.html` fragments |
| Chapter order or titles | `data-chapters` in `index.html` |
| Colours, type, page size | `:root` in `css/style.css` |
| How the book looks | `css/book.css` |
| How the writing looks | `css/pages.css` |
| Motion and its timing | `css/animations.css` |
| Breakpoints and sizing | `css/responsive.css` |
| Background music | `assets/music/background.mp3` |

Adding a chapter means adding one file to `pages/` and one line to the manifest. Nothing
else changes — folios, the ribbon, the counter and the end detection are all derived.

## 9. Future features

The structure already accommodates:

- More chapters, by adding a file and a manifest line.
- A calm ambient scroll view alongside the book.
- A bookmark that remembers the reader's position, as the music control already does.
- Per-chapter numbering derived from the manifest.
- A printed edition, via the print stylesheet already in `responsive.css`.
