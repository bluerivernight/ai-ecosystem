// BFS pathfinding on the shared map grid. 40×26 tiles — BFS is plenty fast
// and smaller than A* here (council: "a 60-line A*" — this is a 40-line BFS).

import { MAP_W, MAP_H, walkable } from '../shared/map.js'

export function findPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number
): Array<[number, number]> {
  if (!walkable(tx, ty)) {
    // find nearest walkable neighbor of the target
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      if (walkable(tx + dx, ty + dy)) {
        tx += dx
        ty += dy
        break
      }
    }
  }
  if (sx === tx && sy === ty) return []

  const key = (x: number, y: number) => y * MAP_W + x
  const visited = new Set<number>([key(sx, sy)])
  const prev = new Map<number, number>()
  const queue: Array<[number, number]> = [[sx, sy]]

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!
    if (cx === tx && cy === ty) {
      // reconstruct
      const path: Array<[number, number]> = []
      let k = key(tx, ty)
      while (k !== key(sx, sy)) {
        path.push([k % MAP_W, Math.floor(k / MAP_W)])
        k = prev.get(k)!
      }
      path.reverse()
      return path
    }
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = cx + dx
      const ny = cy + dy
      const k = key(nx, ny)
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue
      if (visited.has(k) || !walkable(nx, ny)) continue
      visited.add(k)
      prev.set(k, key(cx, cy))
      queue.push([nx, ny])
    }
  }
  return []
}
