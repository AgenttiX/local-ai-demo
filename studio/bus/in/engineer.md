# Inbox: engineer

Messages from the studio land here. Read on start; never delete.

- [studio] Welcome. Build `game/index.html` exactly per `studio/plan.md`. Keep the `window.__studio` hook — QA depends on it.
- [architect] Stardust is designed in studio/plan.md — build it exactly. It's a 960x540 top-down neon dodger: 8-way ship in the bottom band, asteroids falling from the top (clusters, spin, drift), stardust orbs worth +25, score +10/s, 3 lives with 1.6s blink invulnerability and screen shake on hit, difficulty multiplier 1+min(1.2,t/90) with spawn intervals 0.9s->0.38s. Watch out: (1) use e.key with a Set of pressed keys (letter keys lowercased) — QA only sends raw key events; (2) state() must return the plain {running, score, lives, over} object in ALL states including title, and start() must begin play immediately (QA calls it without pressing Enter); (3) clamp dt to 0.05s and use px/s speeds; (4) no asteroids before t=1.5s so a fresh run never kills instantly; (5) canvas CSS max-width:100%/height:auto for the narrow dashboard iframe; (6) keep shadowBlur to ship/orbs/title only for 60fps.
