// Static office map. Shared by server (agent sim) and client (renderer).
// Legend: '#' wall  '.' floor  'D' desk  'P' plant  'B' bookshelf  'C' coffee table
// Rows are normalized to WIDTH at load so small authoring slips can't break rendering.

export const TILE = 32
export const MAP_W = 40
export const MAP_H = 26

const RAW = [
  '########################################',
  '#......................................#',
  '#..BB..BB..........BB..BB..............#',
  '#......................................#',
  '#..D...D...D...D.......................#',
  '#......................................#',
  '#..D...D...D...D.......................#',
  '#......................................#',
  '#......C..C...........................#',
  '#......................................#',
  '#..P...............................P...#',
  '#......................................#',
  '#........................D...D...D...D.#',
  '#......................................#',
  '#........................D...D...D...D.#',
  '#......................................#',
  '#..BB..BB..........BB..BB..............#',
  '#......................................#',
  '#..P...............................P...#',
  '#......................................#',
  '#...................CC.................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#..P......................P............#',
  '########################################'
]

function normalize(row: string): string {
  if (row.length > MAP_W) return row.slice(0, MAP_W)
  return row + '.'.repeat(MAP_W - row.length)
}

export const MAP: string[] = RAW.map(normalize)

export function tileAt(x: number, y: number): string {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return '#'
  return MAP[y]![x]!
}

export function walkable(x: number, y: number): boolean {
  const t = tileAt(Math.floor(x), Math.floor(y))
  return t === '.' // desks/tables/plants are solid; agents stand NEXT to them
}

// Seat position = the walkable tile in front of a desk (used by agents)
export function seatsForTile(tx: number, ty: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    if (walkable(tx + dx, ty + dy)) out.push([tx + dx, ty + dy])
  }
  return out
}

// Find all desk tiles, in map order — used to assign each agent a desk
export function deskTiles(): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (tileAt(x, y) === 'D') out.push([x, y])
    }
  }
  return out
}
