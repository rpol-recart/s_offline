# Tool Selection Mental Model

## Decision Tree: Which Tool To Use

```
I need to run something →
  ├─ Is it a git operation? (status, add, commit, diff, log, push, pull, branch, checkout, stash, merge, rebase, tag)
  │   └─ YES → use `git` tool, pass subcommand WITHOUT "git" prefix
  │            Example: git({ command: "status" }) → executes "git status"
  │            Example: git({ command: "log --oneline -5" }) → executes "git log --oneline -5"
  │
  ├─ Do I need to read a file?
  │   └─ YES → use `read` tool (NOT cat, NOT head, NOT bash)
  │
  ├─ Do I need to write/create a file?
  │   └─ YES → use `write` tool (NOT echo, NOT bash)
  │
  ├─ Do I need to edit part of a file?
  │   └─ YES → use `edit` tool (NOT sed, NOT awk, NOT bash)
  │
  ├─ Do I need to find files by name/pattern?
  │   └─ YES → use `glob` tool (NOT find, NOT ls, NOT bash)
  │
  ├─ Do I need to search file contents?
  │   └─ YES → use `grep` tool (NOT grep via bash, NOT rg via bash)
  │
  ├─ Do I need to run Python code?
  │   └─ YES → use `python_runner` tool (NOT bash + python)
  │
  ├─ Do I need to run docker?
  │   └─ YES → use `docker` tool, pass subcommand WITHOUT "docker" prefix
  │
  └─ Everything else (pip, npm, make, curl, system commands, cd, ls for directories)
      └─ use `bash` tool, pass the FULL command as-is
```

## Common Mistakes to AVOID

| WRONG | WHY | CORRECT |
|-------|-----|---------|
| `git({ command: "cd /path" })` | `cd` is a shell command, not git | `bash({ command: "cd /path && ls" })` |
| `git({ command: "git status" })` | Double prefix → `git git status` | `git({ command: "status" })` |
| `git({ command: "ls" })` | `ls` is a shell command | `bash({ command: "ls" })` |
| `bash({ command: "git status" })` | Use dedicated git tool | `git({ command: "status" })` |
| `bash({ command: "cat file.txt" })` | Use dedicated read tool | `read({ filePath: "file.txt" })` |
| `bash({ command: "grep pattern ." })` | Use dedicated grep tool | `grep({ pattern: "pattern" })` |

## The Key Rule

**Each tool has a domain. Use the most specific tool available.**

- `git` tool adds `git ` prefix automatically → pass only the subcommand
- `docker` tool adds `docker ` prefix automatically → pass only the subcommand
- `bash` tool runs commands AS-IS → pass the full command
- `read`, `write`, `edit`, `glob`, `grep` → file operations, always prefer over bash
