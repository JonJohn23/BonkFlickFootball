# Binho Digital

A browser prototype of tabletop flick football built with Matter.js. The board uses a direct ball flick, mirrored peg symmetry, and a built-in peg editor so you can tune one side and have the other side stay exact.

## Run locally

Serve the folder with any static server:

```bash
python -m http.server 4173
```

Then open <http://localhost:4173>.

> Note: the page loads Matter.js and fonts from public CDNs, so internet access is required.

## Modes

- `Practice`: flick freely without turn switching.
- `Match`: alternate turns between Player 1 and Player 2 after the ball stops.
- `Edit Pegs`: drag only the gold left-side pegs; the gray right-side pegs mirror automatically.

## Controls

- Drag back from the ball and release to flick.
- Click `Edit Pegs` to adjust the left-side peg positions.
- Click `Save Layout` to keep that mirrored peg layout for future sessions.
- Click `Reset` to reset the score, ball, and turn state.
