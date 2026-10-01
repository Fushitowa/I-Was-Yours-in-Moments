Drop your audio file here as `background.mp3`.

## How it is wired

The audio element lives in **one** place only — `index.html`:

```html
<audio id="bgMusic" src="assets/music/background.mp3" loop preload="none"></audio>
```

`js/music.js` owns that element. It is the only module that touches audio, and the
chapter files in `pages/` never reference it.

## Rules

- **Never autoplay.** Browsers block autoplay with sound, and forcing it is rude
  regardless. Playback starts only when the reader presses the music control, which also
  satisfies autoplay policy cleanly.
- `preload="none"` means nothing is fetched until the reader asks for it.
- The control hides itself automatically if the file is missing, so the book works
  completely without audio.
- The reader's choice is remembered in `localStorage`, so the music does not restart on
  every page turn.

## Format

`.mp3` gives the widest support. `.m4a` and `.ogg` also work — if you switch, update the
single `src` in `index.html` and nothing else.

Keep the file small: a 2–4 minute loop at a modest bitrate is plenty. `js/music.js`
plays it at low volume so it sits under the reading rather than competing with it.
