// Client-side movement (same walkability rules as the server's BFS source).
// The user is client-authoritative: no pathfinding needed, direct tile stepping.

import { MAP_W, MAP_H, walkable } from '../shared/map.js'

export function tryMove(x: number, y: number, dx: number, dy: number): [number, number] {
  const nx = Math.min(MAP_W - 1, Math.max(0, x + dx))
  const ny = Math.min(MAP_H - 1, Math.max(0, y + dy))
  if (walkable(nx, ny)) return [nx, ny]
  // slide along one axis if the diagonal is blocked
  if (dx !== 0 && walkable(nx, y)) return [nx, y]
  if (dy !== 0 && walkable(x, ny)) return [x, ny]
  return [x, y]
}
