---
name: parallel-execution
description: "Strategy for identifying and executing parallelizable tasks"
---

# Parallel Execution Skill

## Principle

Independent tasks should run simultaneously via multiple `task` tool calls in a single response.
Dependent tasks must wait for their prerequisites.

## Identifying Parallelism

### Independent (CAN parallelize)
- Tasks working on different files
- Research tasks with no shared output
- Tests and documentation (if code is already written)
- Code review and test writing (both read-only from source)

### Dependent (MUST serialize)
- Code writing → testing (tests need the code to exist)
- Architecture design → implementation (need the design first)
- Bug identification → bug fix (need to know the bug first)
- Any task whose input is another task's output

## Execution Pattern

### Phase 1: Discovery (parallel)
```
task("researcher", "Find all API endpoints in the codebase")
task("architect", "Map the current module dependency graph")
task("researcher", "Search for best practices on [topic]")
```

### Phase 2: Planning (sequential)
Orchestrator synthesizes results, creates plan

### Phase 3: Implementation (parallel where possible)
```
task("coder", "Implement feature A in src/moduleA/")
task("coder", "Implement feature B in src/moduleB/")
task("doc-writer", "Write API documentation for existing endpoints")
```

### Phase 4: Verification (parallel)
```
task("tester", "Write and run tests for feature A")
task("tester", "Write and run tests for feature B")
task("reviewer", "Review implementation of features A and B")
```

### Phase 5: Integration (sequential)
Fix any issues found in Phase 4

## Dependency Graph Notation

Use this in the plan to visualize:

```
[1.1 Research] ──┐
                 ├──→ [2.1 Implement A] ──→ [3.1 Test A] ──┐
[1.2 Architect] ─┤                                          ├──→ [4.1 Integration]
                 ├──→ [2.2 Implement B] ──→ [3.2 Test B] ──┘
[1.3 Research]  ─┘                      ──→ [3.3 Review] ──┘
```

## Rules

1. Launch ALL parallelizable tasks in a SINGLE response (multiple task tool calls)
2. Wait for ALL tasks in a group before moving to the next group
3. If one parallel task fails, others may still succeed — don't cancel everything
4. Track parallel groups in PLAN.md
