# Context Management Rules

## Context Budget (128k models)

All agents operate under a 128k token context limit.
Quality degrades past ~64k tokens.

### Rules

1. **Delegate rather than accumulate** — subagents cost less than context bloat
2. **Delegation prompts ≤ 2000 tokens** — include only what the specialist needs
3. **Agent results ≤ 1000 tokens** — summarize, don't dump
4. **Store state in files** — PLAN.md and ONTOLOGY.md survive compaction
5. **⚠️ WARNING: Subagent recursion risk (#17721)** — avoid delegating to subagents that may spawn further subagents unchecked; always specify a maximum delegation depth

### Known Issues

| Issue | Description | Workaround |
|-------|-------------|------------|
| #16367 | `serve` + `attach` with `"ask"` permissions can hang indefinitely | Use `"allow"` for attached sessions OR avoid combining serve with interactive attach |
| #17721 | Infinite subagent recursion risk when delegating recursively | Enforce max delegation depth of 2 levels; use task tracking in PLAN.md |

### Token Budget Breakdown (128k Context Window)

| Component | Typical Cost | % of Budget |
|-----------|--------------|-------------|
| System prompt | 500-1000 tokens | <1% |
| Code file (read) | 50-500 lines → 100-800 tokens | Varies |
| Delegation prompt | 500-2000 tokens | 2-4% |
| Agent responses (batch of 10) | 1000-5000 tokens | 4-8% |
| PLAN.md + ONTOLOGY.md | 1000-3000 tokens | 3-6% |
| **Safe working range** | **~60k tokens** | **~45%** |
| **Compaction threshold** | **~64k-80k tokens** | **50-60%** |

> 💡 Rule of thumb: Plan compaction at 50% usage, not 80%. Quality degrades faster than you expect.

### Compaction Strategy

Trigger manual compaction when:
- Context exceeds ~50% (64k tokens)
- Before starting a new major phase
- After completing a parallel batch of tasks

Before compaction:
1. Update `project/PLAN.md` with current progress
2. Update `project/ONTOLOGY.md` with latest discoveries
3. Ensure no task is mid-execution

After compaction:
1. Re-read `project/PLAN.md` to restore context
2. Re-read `project/ONTOLOGY.md` for entity knowledge
3. Continue from where the plan indicates

## Model-Specific Optimization

### For All 128k Context Models

1. **Be explicit** — Don't rely on implicit understanding
2. **Use structured formats** — Tables, numbered lists, headers
3. **One task at a time** — Don't combine unrelated requests
4. **Include examples** — Show expected format when specific
5. **Repeat constraints** — State critical constraints at start and end

### Error Recovery

Weaker models make more mistakes. Handle by:
1. **Verification steps** — Run reviewer or tester after code changes
2. **Retry with more detail** — If agent fails, retry with more explicit prompt
3. **Fallback chain** — coder fails → debugger analyzes → coder retries

### Output Token Limits

| Agent Type | Max Tokens |
|------------|------------|
| Orchestrator responses | ≤ 500 |
| Delegation prompts | ≤ 2000 |
| Agent results | ≤ 1000 |
| Plan/Ontology updates | ≤ 3000 |

## Permissions Best Practices (v1.2+)

OpenCode v1.2 uses fine-grained permissions via `permission` config. Key patterns:

### Permission Actions
- `"allow"` — Execute without prompt
- `"ask"` — Prompt for approval (use `once`, `always`, or `reject`)
- `"deny"` — Block operation entirely

### Recommended Defaults

```json
{
  "permission": {
    "*": "allow",
    "bash": "*",
    "edit": {
      "*": "allow",
      "*.env*": "deny"
    },
    "external_directory": "ask",
    "doom_loop": "ask",
    "webfetch": "ask"
  }
}
```

### Pattern Matching Notes
- `*` matches zero-or-more characters
- `?` matches exactly one character
- **Last matching rule wins** — put wildcards first, specifics last
- Use `~` or `$HOME` for home directory expansion in path patterns

### External Directory Access

To allow access outside workspace:

```json
{
  "permission": {
    "external_directory": {
      "~/projects/*": "allow"
    },
    "edit": {
      "~/projects/personal/*": "deny"
    }
  }
}
```

> ⚠️ **CRITICAL**: Always explicitly deny sensitive files (`*.env*`, `.ssh/`, credentials).  
> ⚠️ **CRITICAL**: Avoid combining `serve` + `attach` with `"ask"` permissions (issue #16367 hangs).

## Recommended Models (Local via Ollama)

| Model | Context | Output | Best For |
|-------|---------|--------|----------|
| **Qwen3.5** | 128k | 32k+ | Latest generation; excellent reasoning |
| Qwen 2.5 Coder 32B | 128k | 8k | General coding (recommended default) |
| Qwen 2.5 Coder 7B | 32k | 4k | Fast iteration, simpler tasks |
| DeepSeek Coder V2 | 128k | 8k | Complex refactoring, large context |

⚠️ **Note**: Temperature defaults vary by provider. Set explicitly:
- Code changes: `0.1-0.2`
- Planning/reasoning: `0.3-0.5`
- Creative tasks: `0.7+`

### Configuration (opencode.json)

```json
{
  "model": "ollama/qwen2.5-coder:32b",
  "small_model": "ollama/qwen2.5-coder:7b",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      }
    }
  },
  "temperature": 0.2
}
```

### Before Going Offline

```bash
# Pull all models needed
ollama pull qwen2.5-coder:32b
ollama pull qwen2.5-coder:7b
# Optional: newer models if available
ollama pull qwen3.5-coder:latest

# Verify
ollama list
ollama run qwen2.5-coder:32b 'hello'  # Quick test
```
