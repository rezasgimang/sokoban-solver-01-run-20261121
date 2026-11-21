// Sokoban solver: push-optimal, room by room.
//
// Idea: a generated level is a hallway with 1-4 rooms off it, each room holding
// 3-4 boxes, and a box never leaves its room. So split the level into rooms,
// solve each room with a breadth-first search over PUSHES (first solution found
// is push-optimal), and stitch the rooms' move strings together. The search
// prunes dead squares (a box there can never reach a goal) and frozen 2x2
// blocks, and budgets by STATES, never by the clock, so two runs write the
// same bytes.
//
// Input:  /input/<id>/level.txt  (XSB: # wall, ' ' floor, . goal, $ box,
//         * box on goal, @ player, + player on goal)
// Output: /output/<id>/solution.txt  (moves in LURD; lower = step, UPPER = push)

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
/** States one room search may keep before it gives up (work, not clock). */
const MAX_STATES = 250_000;

const DIRS = [
  { dx: 0, dy: -1, step: 'u', push: 'U' },
  { dx: 0, dy: 1, step: 'd', push: 'D' },
  { dx: -1, dy: 0, step: 'l', push: 'L' },
  { dx: 1, dy: 0, step: 'r', push: 'R' },
];

type Level = {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
};

/** Parse XSB text into a level. Short rows and the outer frame count as walls. */
function parse(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * Live squares: from which a box alone can be pushed onto some goal.
 * Pull back from the goals: a square y is live when pushing a box from y
 * lands on a live square x = y + d while the player can stand at y - d.
 */
function liveSquares(w: number, wall: Uint8Array, goals: number[]): Uint8Array {
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (const dir of DIRS) {
      const d = dir.dy * w + dir.dx;
      const y = x - d;
      if (y < 0 || y >= wall.length) continue;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * Flood fill from `from` over floor squares not occupied by a box.
 * Marks the region in `seen` with `stamp` and returns its lowest square.
 */
function flood(
  w: number,
  wall: Uint8Array,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n];
    if (p < low) low = p;
    for (const dir of DIRS) {
      const q = p + dir.dy * w + dir.dx;
      if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/**
 * Whether the box just pushed to `t` sits in a frozen 2x2 block: four
 * squares of walls and boxes, with a box among them off its goal.
 */
function frozen2x2(
  w: number,
  wall: Uint8Array,
  occupied: Uint8Array,
  goal: Uint8Array,
  t: number,
): boolean {
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (a < 0 || d >= wall.length) continue;
    if (!(wall[a] || occupied[a])) continue;
    if (!(wall[b] || occupied[b])) continue;
    if (!(wall[c] || occupied[c])) continue;
    if (!(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) {
      return true;
    }
  }
  return false;
}

/** A state's key: its region's lowest square plus its sorted boxes. */
function keyOf(low: number, boxes: number[]): string {
  return low + '|' + boxes.join(',');
}

/** Shortest walk from `from` to `to` around walls and boxes (lower LURD). */
function walkTo(
  w: number,
  wall: Uint8Array,
  occupied: Uint8Array,
  from: number,
  to: number,
): string {
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (const dir of DIRS) {
      const q = p + dir.dy * w + dir.dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = dir.step;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: push square out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

/** The square the player stands on after `moves` from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

/**
 * Push-optimal solution of one (sub)level, or null when the search gives up
 * or the level has no solution. Breadth-first over pushes: a state is the
 * boxes' squares plus the player's reachable region (named by its lowest
 * square), so the first solved state met is push-optimal.
 */
function solveRoom(
  level: Level,
  maxStates: number,
): { pushes: number; moves: string } | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const isGoal = new Uint8Array(size);
  for (const g of goals) isGoal[g] = 1;
  const live = liveSquares(w, wall, goals);
  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  const solved = (boxes: number[]): boolean => boxes.every((b) => isGoal[b]);
  if (level.boxes.some((b) => !live[b])) return null;

  const stateBoxes: number[][] = [level.boxes.slice()];
  const statePlayer: number[] = [level.player];
  const parent: number[] = [-1];
  const pushFrom: number[] = [-1];
  const pushTo: number[] = [-1];
  const pushLetter: string[] = [''];
  const index = new Map<string, number>();

  for (const b of level.boxes) occupied[b] = 1;
  const low0 = flood(w, wall, occupied, level.player, seen, ++stamp, stack);
  for (const b of level.boxes) occupied[b] = 0;
  index.set(keyOf(low0, level.boxes), 0);

  let found = solved(level.boxes) ? 0 : -1;
  for (let head = 0; found < 0 && head < stateBoxes.length; head++) {
    const boxes = stateBoxes[head];
    for (const b of boxes) occupied[b] = 1;
    flood(w, wall, occupied, statePlayer[head], seen, ++stamp, stack);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi];
      for (const dir of DIRS) {
        const d = dir.dy * w + dir.dx;
        const behind = b - d;
        const target = b + d;
        if (seen[behind] !== here) continue;
        if (wall[target] || occupied[target] || !live[target]) continue;
        occupied[b] = 0;
        occupied[target] = 1;
        const frozen = frozen2x2(w, wall, occupied, isGoal, target);
        let key = '';
        let nextBoxes: number[] | null = null;
        if (!frozen) {
          nextBoxes = boxes.slice();
          nextBoxes[bi] = target;
          nextBoxes.sort((a, b2) => a - b2);
          const low = flood(w, wall, occupied, b, mark, ++stamp, stack);
          key = keyOf(low, nextBoxes);
        }
        occupied[target] = 0;
        occupied[b] = 1;
        if (frozen || index.has(key)) continue;
        if (stateBoxes.length >= maxStates) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        index.set(key, stateBoxes.length);
        stateBoxes.push(nextBoxes!);
        statePlayer.push(b);
        parent.push(head);
        pushFrom.push(b);
        pushTo.push(target);
        pushLetter.push(dir.push);
        if (solved(nextBoxes!)) {
          found = stateBoxes.length - 1;
          break;
        }
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;

  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes.slice();
  for (const s of path) {
    const nextBoxes = stateBoxes[s];
    const from = pushFrom[s];
    const to = pushTo[s];
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(w, wall, occupied, player, from - (to - from));
    for (const b of boxes) occupied[b] = 0;
    moves += pushLetter[s];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

type Room = {
  squares: number[];
  boxes: number[];
  goals: number[];
  done: boolean;
};

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway:
 * a box there reaches no goal) out of the floor, and each part left that
 * holds a box is a room. Null when a box starts in the hallway, a goal sits
 * in the cut, or some part holds more or fewer boxes than goals.
 */
function splitRooms(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(w, wall, goals);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const comp = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || comp[s] >= 0) continue;
    const squares = [s];
    comp[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const dir of DIRS) {
        const q = squares[i] + dir.dy * w + dir.dx;
        if (!wall[q] && !cut[q] && comp[q] < 0) {
          comp[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[comp[b]].boxes.push(b);
  for (const g of goals) {
    if (comp[g] < 0) return null;
    rooms[comp[g]].goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/**
 * The level solved room by room: each room's push-optimal solution in turn,
 * the other rooms' boxes standing as walls (on their goals once their room
 * is done), the player walking on from where the last room left it. A box
 * never leaves its room, so the rooms' optima add up to the level's.
 * Falls back to a whole-level search when the level is no set of rooms.
 */
function solveLevel(text: string): string {
  const level = parse(text);
  const rooms = splitRooms(level);
  if (rooms === null) {
    const whole = solveRoom(level, MAX_STATES);
    return whole ? whole.moves : '';
  }
  let player = level.player;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      const blockers = other.done ? other.goals : other.boxes;
      for (const b of blockers) wall[b] = 1;
    }
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solved = solveRoom(sub, MAX_STATES);
    if (solved === null) return '';
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
    room.done = true;
  }
  return moves;
}

for (const id of readdirSync(INPUT).sort()) {
  const moves = solveLevel(readFileSync(join(INPUT, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUTPUT, id), { recursive: true });
  writeFileSync(join(OUTPUT, id, 'solution.txt'), `${moves}\n`);
}
