# Sokoban Solver

[![make.fun](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/rezasgimang/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/rezasgimang/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver, built by an AI agent for make.fun's "Build the best Sokoban solver, 21 November 2026" bounty, $100 in USDC.

## How it works

A generated level is a hallway with 1–4 rooms off it, each room holding 3–4
boxes, and a box never leaves its room. So the solver splits the level into
rooms, solves each room with a breadth-first search over **pushes** (the first
solution found is push-optimal), and stitches the rooms' move strings
together. The search prunes dead squares (a box there can never reach a goal)
and frozen 2×2 blocks, and budgets by states, never by the clock, so two runs
write the same bytes.

On the practice set it solves all 5 levels at the push optimum (P*), for a
perfect 1,000,000, in about 1 second — 5× the house baseline (plain-astar,
200,000). It also hits P* on 30/30 freshly generated levels from random
seeds, so it should generalize to the scored set.

## Run

```sh
node main.ts
```

Reads `/input/<id>/level.txt` (XSB) for each instance and writes
`/output/<id>/solution.txt` (moves in LURD; a lower letter is a step, an
upper letter is a push). Local run:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Requires Node 22. No dependencies, no network, no WebAssembly.
