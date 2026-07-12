# Splash Siege 🎈🪚🌱

A Devvit (Reddit) arcade game. Water balloons fall from the sky — shoot them
before they land, because every splash of water grows the plants below. Plants
wall you in as they grow, and if a single plant reaches the top of the screen,
the garden wins and it's game over. Some balloons carry **chainsaws**: pop
them, grab the falling saw, and walk into a plant to cut it down and buy
yourself time. Survive **6 levels**, each harder than the last, and rack up
the highest score.

## How to play

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | ← / → or A / D | ◀ / ▶ buttons |
| Shoot | Space (or click the canvas) | ● button / tap |
| Cut a plant | Walk into it while holding a saw | Same |

### Scoring
- Pop a balloon: **+10** (chainsaw balloon: **+15**)
- Grab a chainsaw: **+5** (gives 3 cuts, max 9 stored)
- Cut down a plant: **+25**
- Clear a level: **+100 × level**, beat level 6: **+250**

### Mechanics worth knowing
- A balloon popped *below the dashed clothesline* still splashes the ground
  with half its water — shoot high!
- From level 4 onward, splashes also water neighbouring plants.
- Between levels the storm pauses and every plant wilts slightly — your only
  breather.
- Best scores are stored per-player in Redis; the game-over screen shows the
  subreddit's top 5.

## Level design

| Level | Spawn every | Fall speed | Pops to clear | Growth per splash | Saw balloons |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.60s | 60 px/s | 10 | 46 px | 20% |
| 2 | 1.35s | 74 px/s | 14 | 54 px | 17% |
| 3 | 1.15s | 90 px/s | 18 | 62 px | 14% |
| 4 | 0.95s | 106 px/s | 22 | 72 px + spread | 12% |
| 5 | 0.80s | 124 px/s | 26 | 82 px + spread | 10% |
| 6 | 0.62s | 146 px/s | 30 | 94 px + spread | 8% |

Tune everything in the `LEVELS` array at the top of `src/client/game.js`.

## Project structure

```
splash-siege/
├── devvit.json          # Devvit app config (post entrypoint, server, menu)
├── package.json
├── src/
│   ├── client/          # the game (plain HTML/CSS/canvas JS, no bundler)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── game.js
│   └── server/
│       └── index.ts     # Express server: /api/init, /api/score,
│                        # /api/leaderboard + post-creation endpoints
└── assets/
```

## Setup & deploy

Requires Node 22+ and the Devvit CLI.

```bash
npm install -g devvit
devvit login

cd splash-siege
npm install

# devvit.json "name" must be globally unique — change "splash-siege"
# if it's taken, then:
npm run dev        # builds + playtests in r/splash_siege_dev (see devvit.json "dev")
npm run deploy     # devvit upload
npm run launch     # upload + publish for review
```

Installing the app on a subreddit auto-creates a game post
(`onAppInstall` trigger); moderators can also create posts from the
subreddit's "..." menu ("Create Splash Siege post").

> Built and type-checked against the current `@devvit/web` release. Devvit's
> APIs move quickly — if anything has shifted, `devvit playtest` will point at
> the exact line; the game client itself is dependency-free.

## Local testing (no Reddit needed)

The game runs standalone — just open `src/client/index.html` in a browser.
Score saving/leaderboard calls fail silently outside of Devvit.
