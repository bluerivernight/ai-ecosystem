// Skills folder loader. Every file in skills/*.json is a SkillManifest.
// A skill gives an agent extra instructions + a preferred tool list.
// This manifest format is a deliberate open artifact (council: "marketplace seed").

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SkillManifest } from '../shared/types.js'
import { SKILLS_DIR } from './config.js'

export class SkillRegistry {
  private skills: SkillManifest[] = []

  load(): SkillManifest[] {
    this.skills = []
    try {
      for (const f of readdirSync(SKILLS_DIR)) {
        if (!f.endsWith('.json')) continue
        try {
          const raw = JSON.parse(readFileSync(path.join(SKILLS_DIR, f), 'utf8')) as SkillManifest
          if (raw?.name && raw?.description && raw?.instructions) {
            this.skills.push(raw)
          } else {
            console.error(`[skills] ${f} is missing name/description/instructions — skipped`)
          }
        } catch (e) {
          console.error(`[skills] ${f} is not valid JSON — skipped (${String(e)})`)
        }
      }
    } catch {
      // skills folder missing entirely is fine
    }
    console.log(`[skills] loaded ${this.skills.length} skill(s)`)
    return this.skills
  }

  list(): SkillManifest[] {
    return this.skills
  }

  /** Skills whose name/description/keywords match the task text. */
  match(taskText: string, limit = 2): SkillManifest[] {
    const words = taskText.toLowerCase()
    const scored = this.skills
      .map(s => {
        const hay = `${s.name} ${s.description} ${(s.keywords ?? []).join(' ')}`.toLowerCase()
        const score = words
          .split(/\W+/)
          .filter(w => w.length > 2 && hay.includes(w))
          .length
        return { s, score }
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map(x => x.s)
  }

  /** Prompt text for a set of skills (compact — tiny context windows). */
  promptText(skills: SkillManifest[]): string {
    if (skills.length === 0) return ''
    return (
      '\nSKILLS you should follow for this task:\n' +
      skills
        .map(s => `### ${s.name}\n${s.instructions.slice(0, 600)}`)
        .join('\n')
    )
  }
}
