# Bonk Flick Football 3D

A browser game inspired by tabletop flick football (like Binho), rendered in 3D with a Binho-style board: proper field markings, goals, elastic-band rails, and mirrored peg layout.

## Run locally

Serve the folder with a static server:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

> Note: `game.js` imports Three.js from a CDN, so internet access is required when loading the game.

## Controls

- Click + drag **from your current turn's puck** to aim and set power.
- Release to flick.
- Use pegs for bank shots and blockers.
- First player to 5 goals wins.
