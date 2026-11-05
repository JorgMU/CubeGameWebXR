# Thul Changes — fixed14 (2026-11-05)

Based on fixed13. Only `app/main.js`, `app/index.html`, and
`README.md` change (plus this note).

## HUD toggle key: Space → H

Space is the standard key for activating the control that currently
has focus, so using it to hide/show the HUD panel was surprising:
Tab to a button, press Space expecting a click, and the panel
disappeared instead. (The fixed12 version did `preventDefault()` so
it would not also click, but the expectation was still wrong.)

- `app/main.js`: **H** now hides/shows the top-left HUD panel in
  2D mode. H again brings it back. Space no longer toggles the panel
  at all, so it is free for its standard job, and Enter still
  activates a focused button as well.
- `app/index.html` and `README.md`: the help text and the desktop
  controls list now say "H hide/show this panel".

No other key changes. The game itself keeps running while the panel
is hidden; only the panel is affected.
