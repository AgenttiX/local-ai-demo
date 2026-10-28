# Game Plan

> The **architect** fills this in from `studio/prompt.txt`. The **engineer** builds
> exactly what is written here. QA judges the finished game against it.

## Brief
(see `studio/prompt.txt`)

## Game
_TODO (architect)_

## Controls
_TODO (architect)_

## Rules
_TODO (architect)_

## Look
_TODO (architect)_

## Test hook (contract — do not change)
The game must expose:

```js
window.__studio = { start(), state() }
// state() -> { running: bool, score: number, lives: number, over: bool }
```

The canvas must scale into any container: `canvas { max-width: 100%; height: auto; }`
(the dashboard embeds the game in a narrow iframe — it must look right at any size).
