# Thul Changes — v16 (2026-11-05)

Based on fixed15. Only `app/main.js` changes (plus this note).

## Debug panel moved: south edge → east edge

The in-world debug readout (small grey text, P / Debug button) was
lying flat just beyond the **south** edge of the board, in front of
the player below the board. It is now just beyond the **east** edge
instead:

- `app/main.js`: `debugPanel.position` changed from
  `(0, 0.012, BOARD_SIZE / 2 + debugPanelHeight / 2 + 0.05)` to
  `(BOARD_SIZE / 2 + 1.8 / 2 + 0.05, 0.012, 0)` — east of the board,
  centred north-south, with the same small 0.05 m gap.
- Orientation is unchanged: the panel still lies flat, long side
  east-west, text top to the north, so it reads the same way from the
  south as it did before. It is just no longer in front of the player.
- The scores panel stays where it was, on the west side, so the two
  side panels are now balanced: scores west, debug east. The status
  panel stays on the north edge.

The 2D HUD debug readout (`#hudDebug`, top-left panel) is unchanged
— this is only the in-world panel.
