# Skills folder

Every `.json` file here is a **skill** — an instruction card an agent can pick up
when a task matches it. No code, no build step. Drop a file in this folder and
the server picks it up on the next restart.

## Format

```json
{
  "name": "Meeting Notes",
  "description": "Turns messy notes into a clean summary",
  "instructions": "When writing meeting notes: 1) one-line summary first, 2) bullet decisions, 3) bullet who-does-what, 4) keep it under 200 words.",
  "keywords": ["meeting", "notes", "summary"],
  "tools": ["write_file"]
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Skill name, shown to agents |
| `description` | yes | One line — helps match the skill to tasks |
| `instructions` | yes | What the agent should do (max ~600 chars used) |
| `keywords` | no | Words that make this skill match a task |
| `tools` | no | Hint: which tools this skill mainly uses |

Agents pick at most **2 skills per task**, matched by keywords in the task text.
