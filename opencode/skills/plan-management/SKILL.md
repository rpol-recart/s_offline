---
name: plan-management
description: "Manage the project plan file — add tasks, update status, track progress"
---

# Plan Management Skill

## Plan File Location
`project/PLAN.md`

## Plan Structure

The plan file uses this format:

```markdown
# Project Plan: [Project Name]

> Last updated: [ISO timestamp]
> Status: [IN_PROGRESS | BLOCKED | COMPLETED]

## Goal
[High-level description of what we're building]

## Assumptions
- [Assumptions made when no clarification was available]

## Phase N: [Phase Name]

### Task N.1: [Task Name]
- **Status**: 🔴 TODO | 🟡 IN_PROGRESS | 🟢 DONE | 🔵 DELEGATED | ⛔ BLOCKED | ❌ FAILED
- **Agent**: [which specialist agent handles this]
- **Dependencies**: [task IDs this depends on]
- **Description**: [what needs to be done]
- **Result**: [outcome after completion]
- **Notes**: [any relevant observations]

## Parallel Execution Groups

### Group 1 (can run simultaneously)
- Task 1.1
- Task 1.2

### Group 2 (after Group 1 completes)
- Task 2.1

## Decision Log
| # | Decision | Rationale | Made By |
|---|----------|-----------|---------|
| 1 | [what]   | [why]     | [orchestrator/user] |

## Blocked Items
- [Item]: [reason blocked] → [what's needed to unblock]
```

## Operations

### Add a new task
Read the current plan, append a new task under the appropriate phase, write back.

### Update task status
Read the plan, find the task by ID, update its status and result field, write back.

### Add a decision
Read the plan, append to the Decision Log table, write back.

### Check progress
Read the plan, count tasks by status, report summary.

## Important Rules

- Always include a timestamp when updating
- Never delete completed tasks — they're history
- Failed tasks should include failure reason
- Keep task descriptions concise but complete
