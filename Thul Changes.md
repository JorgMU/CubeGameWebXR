# Thul Changes — v20 (2026-11-05)

Based on v19. Only `app/index.html` changes (plus this note).

## Top-right 2D buttons: same glowy green style as Start MR

The five buttons in the top-right bar (Next level, Restart level,
Debug, Clear scores, Force refresh) now look exactly like the
Start MR button:

- `app/index.html`: `#hudButtons button` is now `8px 6px` padding,
  `1px solid #00ff66` border, `#00ff66` text, dark background
  `rgba(0,0,0,0.35)`, green `text-shadow` and `box-shadow` glow,
  `13px sans-serif` (was white-on-transparent, `6px 8px`, 12 px).
- Still faded to opacity 0.5 until hover, like the MR button.
- The Start MR button itself (`app/scene.js`) is unchanged.
