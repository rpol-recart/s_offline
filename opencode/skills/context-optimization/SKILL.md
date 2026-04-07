---
name: context-optimization
description: "Strategies for efficient context usage with 128k token models"
---

# Context Optimization Skill

## Context Budget: 128,000 tokens

With weak models on 128k context, every token matters. Quality degrades significantly past 50% usage (~64k tokens).

## Strategy 1: Targeted Reading

**NEVER** read entire large files. Instead:
1. Use `glob` to find files by pattern
2. Use `grep` to locate specific lines
3. Read only the relevant section (with line offset + limit)

```
BAD:  read("src/app.ts")                    // 5000 lines
GOOD: grep("handleAuth", "src/app.ts")      // 3 matching lines
      read("src/app.ts", offset=142, limit=30)  // just the function
```

## Strategy 2: Delegation Over Accumulation

Instead of reading 10 files yourself, delegate to a specialist:
```
task("coder", "Read src/auth/*.ts and add rate limiting to the login endpoint")
```
The subagent has its own 128k context — you don't consume yours.

## Strategy 3: Persistent State in Files

Store discoveries in `project/ONTOLOGY.md` and progress in `project/PLAN.md`.
After compaction, re-read these files to restore context.

## Strategy 4: Concise Delegation Prompts

```
BAD:  "I've been analyzing the codebase and I've noticed that the authentication
       module located in the src/auth directory has several files including..."
       (500+ tokens of preamble)

GOOD: "Add rate limiting to src/auth/login.ts:handleLogin(). Use express-rate-limit.
       Limit: 5 attempts/15min per IP. Return 429 on exceed."
       (40 tokens, complete specification)
```

## Strategy 5: Batch Results

When multiple agents return results, summarize into a few key points.
Don't paste full agent outputs into your context — extract the essence.

## Strategy 6: Early Compaction

If you notice context growing large:
1. Update PLAN.md and ONTOLOGY.md with current state
2. Let auto-compaction happen (triggers at 95%)
3. After compaction, re-read PLAN.md to resume

## Token Budget Allocation

| Purpose | Budget | Notes |
|---------|--------|-------|
| System prompt | ~5k | Fixed overhead |
| Plan + Ontology | ~3k | Read at start of each major phase |
| User conversation | ~10k | Keep concise |
| Agent delegation | ~2k per task | Self-contained prompts |
| Agent results | ~1k per result | Summarize if larger |
| Working memory | ~40k | Searching, reading code snippets |
| Safety buffer | ~30k | Leave for model to reason |
