# Agent Communication Protocol

## Orchestrator → Specialist

Every delegation prompt MUST follow this structure:

```markdown
## Task
[1-2 sentences: what exactly to do]

## Context
[Essential background: what project this is, relevant decisions already made]

## Files
[Specific file paths to read/modify — never say "figure it out"]

## Expected Output
[Exact format of the response]

## Constraints
- [Hard requirements]
- [Boundaries — what NOT to do]
```

### Good Prompt Example
```
## Task
Add input validation to the user registration endpoint.

## Context
This is an Express.js API. We use Zod for validation. The registration
endpoint is at POST /api/auth/register.

## Files
- Read: src/routes/auth.ts (the endpoint handler)
- Read: src/schemas/ (existing Zod schemas for patterns)
- Modify: src/routes/auth.ts

## Expected Output
Modified auth.ts with Zod validation for: email (valid format),
password (min 8 chars, 1 uppercase, 1 number), username (alphanumeric, 3-20 chars).
Return 400 with validation errors on failure.

## Constraints
- Use existing Zod patterns from src/schemas/
- Don't change the response format for successful registration
- Don't add new dependencies
```

### Bad Prompt Example
```
Add validation to the registration endpoint. Make sure it validates
email and password properly. The code is somewhere in the auth folder.
```

## Specialist → Orchestrator

Results MUST include:
1. **What was done** — list of changes
2. **Files modified** — exact paths
3. **Issues found** — anything unexpected
4. **Status** — SUCCESS / PARTIAL / FAILED

Keep under 1000 tokens.

## Error Reporting

```markdown
## Status: FAILED

### Error
[What went wrong]

### Attempted
[What approaches were tried]

### Suggestion
[How the orchestrator might fix this — different approach, more info needed, etc.]
```

## Error Recovery Patterns

When an agent encounters an error, follow this decision tree:

| Situation | Action |
|-----------|--------|
| **Transient/network error** | Retry 2x with exponential backoff (1s → 2s), then escalate |
| **Missing file/permission denied** | Do NOT retry; report to orchestrator immediately |
| **Syntax/compile error** | Fix if clear; otherwise call for debugger specialist |
| **Dependency/version conflict** | Escalate to orchestrator - don't guess versions |
| **Same error after 2 attempts** | ESCALATE - mark in PLAN.md as "blocked" |

### Context Isolation Warning ⚠️

> **Do NOT assume agents share state!** Each subagent runs in its own session context.
> - State persists only in files (`PLAN.md`, `ONTOLOGY.md`, code)
> - Shared knowledge must be written to disk or passed explicitly in delegation prompt
> - Never say "as you know" or "we established that" between agent handoffs

### Skill Loading in Delegation

When delegating tasks requiring specific skills, reference them explicitly:

```markdown
## Task
Set up Grafana dashboard for ClickHouse metrics.

## Skills Required
- monitoring-stack (provides grafana provisioning templates, alert syntax)

## Files
...
```

The orchestrator will ensure the skill is loaded before delegation. If unsure which skill applies, state the *capability needed* not the skill name:

```markdown
## Task
Configure Kafka consumer group lag monitoring.

## Capabilities Needed
- Monitoring stack setup (Grafana/Zabbix alerts)
```
