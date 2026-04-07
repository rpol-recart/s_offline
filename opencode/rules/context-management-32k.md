# Context Management Rules (32K Window)

## Context Budget (32K models)

All agents operate under a **32K token context limit**.
Quality degrades past ~16K tokens. Compaction at 50% = 16K.

### CRITICAL: 32K is 4x smaller than 128K

Every token is precious. Rules are stricter:

1. **NEVER read full files** — use line ranges (`read 50-120`), grep, or symbol lookup
2. **Delegate aggressively** — subagent context is FREE (separate window)
3. **Delegation prompts ≤ 800 tokens** — half of 128K budget
4. **Agent results ≤ 500 tokens** — diff-style, not narrative
5. **ONTOLOGY.md is your map** — invest heavily in keeping it current
6. **Compaction at 30%** (~10K tokens), not 50%
7. **One file per task** — never work on 2+ files simultaneously in context

### Token Budget Breakdown (32K Context Window)

| Component | Max Cost | % of Budget |
|-----------|----------|-------------|
| System prompt | 800 tokens | 2.5% |
| PLAN.md (compact) | 500 tokens | 1.5% |
| ONTOLOGY.md (compact) | 1500 tokens | 5% |
| Delegation prompt | ≤800 tokens | 2.5% |
| Code in context | ≤5000 tokens (~150 lines) | 15% |
| Conversation history | ≤4000 tokens | 12.5% |
| **Safe working range** | **~12K tokens** | **~38%** |
| **Compaction threshold** | **~16K tokens** | **~50%** |

### Reading Code: Progressive Disclosure

Instead of reading full files, use this protocol:

1. **First**: Read ONTOLOGY.md for file/function map
2. **Second**: `grep` for specific symbol/pattern
3. **Third**: Read ONLY the relevant function (line range)
4. **NEVER**: Read entire file unless <100 lines

Example — BAD (wastes 2000 tokens):
```
read src/api/users.ts
```

Example — GOOD (wastes 200 tokens):
```
grep "getUserData" src/api/users.ts    → line 142
read src/api/users.ts 140-180          → only the function
```

### Delegation Protocol (32K version)

**Orchestrator → Specialist:**
```
Task: [1 sentence]
File: [exact path]
Lines: [range or function name]
Context: [2-3 sentences max]
Output: [exact format — diff preferred]
```

**Specialist → Orchestrator:**
```
Status: SUCCESS/PARTIAL/FAILED
Changed: [file:lines]
Diff: [minimal diff]
Issue: [if any, 1 sentence]
```

Total delegation round-trip: ≤1300 tokens (800 + 500)

### ONTOLOGY.md: Your External Brain

With 32K, ONTOLOGY.md becomes the MOST important file.
Keep it updated obsessively:

- Every module discovered → add to Entities
- Every function touched → add to Key Files
- Every dependency found → add to Relationships
- Every pattern noticed → add to Patterns

When context is compacted, ONTOLOGY.md is what restores understanding.

### Compaction Strategy (Aggressive)

Trigger compaction when:
- Context exceeds 30% (10K tokens) — NOT 50%
- Before ANY new task starts
- After EVERY completed task

Before compaction:
1. Update PLAN.md with progress (keep under 500 tokens)
2. Update ONTOLOGY.md with discoveries
3. Write any findings to task result files

After compaction:
1. Re-read PLAN.md (500 tokens)
2. Re-read ONTOLOGY.md (1500 tokens)
3. Total restoration cost: 2000 tokens = 6% of budget

### Output Limits (Strict)

| Agent Type | Max Tokens |
|------------|------------|
| Orchestrator responses | ≤ 300 |
| Delegation prompts | ≤ 800 |
| Agent results | ≤ 500 |
| Plan updates | ≤ 500 |
| Ontology updates | ≤ 1500 |

### Anti-Patterns (FORBIDDEN)

1. ❌ Reading file >150 lines into context
2. ❌ Asking agent to "explore" or "understand" a module (too vague)
3. ❌ Keeping old conversation turns after task completion
4. ❌ Storing code snippets in PLAN.md (use file references)
5. ❌ Multiple grep results in context (use first match, read targeted)
