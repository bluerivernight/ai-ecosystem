// Tiny pixel-art sprites defined as character grids — no image files needed.
// Palette keys: H hair, s skin, T shirt, p pants, o shoes, e eyes, . transparent
// Rows are padded/truncated to 16 at parse time so authoring slips are safe.

export interface Sprite {
  w: number
  h: number
  frames: string[][][] // one entry per frame; each frame is rows of chars
}

function parse(raw: string[], size = 16): string[][] {
  return raw.map(r => {
    let row = r.length > size ? r.slice(0, size) : r + '.'.repeat(size - r.length)
    return row.split('')
  })
}

const IDLE = parse([
  '................',
  '.....HHHH.......',
  '....HHHHHH......',
  '....HssssH......',
  '....ssees.......',
  '....ssssss......',
  '.....ssss.......',
  '....TTTTTT......',
  '...TTTTTTTT.....',
  '...TsTTTTsT.....',
  '...TTTTTTTT.....',
  '....pppppp......',
  '....pp..pp......',
  '....pp..pp......',
  '...oo....oo.....',
  '................'
])

const WALK = parse([
  '................',
  '.....HHHH.......',
  '....HHHHHH......',
  '....HssssH......',
  '....ssees.......',
  '....ssssss......',
  '.....ssss.......',
  '....TTTTTT......',
  '...TTTTTTTT.....',
  '...TsTTTTsT.....',
  '...TTTTTTTT.....',
  '....pppppp......',
  '...pp....pp.....',
  '...pp....pp.....',
  '..oo......oo....',
  '................'
])

export const PERSON: Sprite = { w: 16, h: 16, frames: [IDLE, WALK] }

export interface PersonColors {
  shirt: string
  hair: string
  pants: string
  shoes: string
  skin: string
}

// Colors are CSS hex strings substituted at draw time
export const DEFAULT_PALETTE: PersonColors = {
  shirt: '#4a7ec4',
  hair: '#3a2e26',
  pants: '#33383f',
  shoes: '#22252a',
  skin: '#e8b98a'
}
