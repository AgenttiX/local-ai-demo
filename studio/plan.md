# Game Plan

> The **architect** fills this in from `studio/prompt.txt`. The **engineer** builds
> exactly what is written here. QA judges the finished game against it.

## Brief
Build "Stardust" — a neon arcade game where a tiny ship dodges an endless stream
of asteroids and collects stardust; 3 lives, a score, and a game-over screen,
all in one HTML file.

## Game

- **Name:** STARDUST
- **One-line pitch:** a tiny neon starship weaves through an endless downward
  stream of drifting asteroids, scooping golden stardust to bank points, with
  3 lives and a game-over screen.
- **Feel & tone:** fast, tense, hypnotic neon arcade. Smooth 60 fps, snappy
  8-way movement, forgiving hitboxes so dodging feels fair, and satisfying
  particle bursts for every pickup and impact. No text scrolling, no music —
  pure visual rhythm on a dark starfield.

## Controls

Read keys with `e.key` (normalize letter keys with `e.key.toLowerCase()`);
track pressed keys in a `Set` on `keydown`/`keyup`.

| Key (`e.key`) | Action |
| --- | --- |
| `ArrowLeft` / `a` | move ship left |
| `ArrowRight` / `d` | move ship right |
| `ArrowUp` / `w` | move ship up |
| `ArrowDown` / `s` | move ship down |
| `Enter` or `Space` | start the game from the title screen; restart from the game-over screen |
| mouse click | same as Enter (start / restart only) |

- Multiple keys combine (diagonal movement = normalize the combined vector).
- `Space` does nothing during active play (dodging only — no special move).
- Call `preventDefault()` for arrows and space so the page never scrolls.

## Rules

**State machine:** `title` → `play` → `over` → (Enter/Space/click) → `play`.
`window.__studio.start()` jumps straight into `play` from any state (the
playtest calls it without pressing anything).

- **Playfield:** 960×540 logical canvas. The ship is confined to the bottom
  band: y ∈ [310, 516], x ∈ [16, 944]. Asteroids and dust spawn at the top
  (y = −30) and fall downward; nothing wraps or bounces.
- **Ship:** speed 360 px/s, drawn as a small upward-pointing triangle (~22 px),
  circle hitbox r = 11 (smaller than the visual — forgiving on purpose).
  Trails 2–3 fading cyan particles per frame from its rear.
- **Lives:** start with 3. Hitting an asteroid: lives −1, that asteroid
  shatters into shards, ship gets **1.6 s of invulnerability** (blinking at
  10 Hz alpha), screen shake 8 px decaying over 0.4 s, red vignette flash
  200 ms. While invulnerable the ship can pass through asteroids. If lives
  reach 0 → `over` (freeze all entity updates; keep the starfield drifting).
- **Asteroids:** circle collision, radius 12–28 (random per spawn). Fall
  speed vy = (110 + rand·100) × difficulty mult; horizontal drift vx ∈ [−50,
  50] px/s; spin −2…+2 rad/s. Draw as a rotating noisy polygon: 8 vertices
  with per-vertex radius jitter 0.8–1.2 (precomputed per asteroid).
- **Spawning (timers, seconds):**
  - Asteroids: interval `max(0.38, 0.9 − t/150)` — starts at 0.9 s, settles at
    0.38 s. Each tick spawns 1 asteroid (60%), or a cluster of 2 (25%, spread
    apart in x), or 3 (15%). **No asteroids spawn before t = 1.5 s.**
  - Stardust: interval `max(0.8, 1.6 − t/200)` — starts at 1.6 s, settles at
    0.8 s. Orb r = 7, falls vy = 130–200 px/s with a sinusoidal sway (amplitude
    20 px, 1–2 Hz).
- **Score:** +10 per second survived (accumulate fractionally, display floored)
  + **25 per stardust** collected. Collection: orb disappears, 10 gold sparks
  burst + an expanding ring flash; small "+25" pop-up text at the pickup point
  that floats up and fades.
- **Difficulty curve:** `t` = seconds since the run started. Speed multiplier
  = `1 + min(1.2, t/90)` — at t = 0 mult 1.0, at t = 60 mult 1.67, at t = 90+
  mult 2.2 (capped). Spawning gets denser as above. After ~2 min the game
  stays hard but stable — no further escalation.
- **Off-screen cleanup:** remove any asteroid or dust with y > 570 (no
  penalty, no event).
- **Game-over screen:** big "GAME OVER" (#f43f5e glow), "SCORE 000000" and a
  "press ENTER or SPACE" prompt pulsing at 1.5 Hz. Enter/Space/click resets
  score, lives = 3, t = 0, clears all entities, and restarts play immediately.

**Engine notes (implement exactly):**

- Single `requestAnimationFrame` loop; `dt = min(0.05, (now − last)/1000)` —
  all speeds above are in px/second, multiply by dt.
- One plain-object particle array `{x, y, vx, vy, life, maxLife, size, color}`
  used for trails, shards, and sparks (shards: 12–18 per destroyed asteroid,
  slate-colored; gravity 0 — straight-line fade is fine).
- Everything else is plain arrays of entity objects; no classes required.
- Page load shows the **title screen** (see Look); the game is not running
  until Enter/Space/click or `__studio.start()`.

## Look

- **Canvas:** 960×540 logical size; CSS `canvas { max-width: 100%; height: auto; }`
  centered in a page with background `#05070c` (must look right at any size —
  the dashboard embeds it in a narrow iframe).
- **Palette (hex):**

  | Element | Color(s) |
  | --- | --- |
  | Space background | vertical gradient `#0a0e14` → `#101a2e` |
  | Starfield (2 parallax layers) | far 60 stars `#3b4a66`, near 30 stars `#7d90b8` + 6 bright `#cfe3ff`; drift downward slowly (far 12 px/s, near 30 px/s), wrap around |
  | Ship body | `#22d3ee` with cyan glow (`shadowColor` same, `shadowBlur` 15) |
  | Ship cockpit | `#e0f2fe` |
  | Asteroid | fill `#141a24`, outline `#8b93a7` 2 px, inner speckles `#334155` |
  | Stardust orb | core `#fbbf24`, glow `#fde68a` (`shadowBlur` 18) |
  | Pickup flash / text pop | `#ffffff` / `#fde68a` |
  | Hit flash / game-over red | `#f43f5e` |
  | HUD text | `#cfe3ff` (values), `#7d90b8` (labels) |
  | Title "STARDUST" | `#22d3ee` with cyan glow; "press ENTER" prompt `#fbbf24` pulsing |

- **Font:** system monospace (`ui-monospace, "Courier New", monospace`).
  HUD is 16 px, title is ~48 px. No external fonts, no images, no audio files.
- **HUD layout (drawn on canvas):**
  - top-left: `SCORE` label + 6-digit zero-padded value
  - top-center: 3 mini-ship glyphs (10 px triangles) — bright cyan `#22d3ee`
    while the life is alive, dim `#1f2937` when lost
  - top-right: elapsed time `00:00` in `#7d90b8`
- **VFX summary:** engine trail (cyan, fading), asteroid shards (slate), dust
  sparks (gold) + expanding ring, hit: red vignette flash + 8 px screen shake
  (translate the whole scene by a decaying random offset), invulnerable ship
  blinks. Use `shadowBlur` for glows but keep it to ship, orbs, and title only
  (turn it off for bulk entities) to protect the 60 fps target.

## Test hook (contract — do not change)
The game must expose:

```js
window.__studio = { start(), state() }
// state() -> { running: bool, score: number, lives: number, over: bool }
```

- `state()` must return a plain object at **all** times (title, play, over)
  with exactly those four keys: `running = (mode === "play")`,
  `over = (mode === "over")`, `score` is the current run's floored score
  (0 on title), `lives` is the current life count (3 on title).
- `start()` must begin a fresh run immediately from any state — the QA
  playtest calls it and then only sends raw key events, never a click or
  Enter.
