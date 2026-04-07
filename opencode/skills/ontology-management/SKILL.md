---
name: ontology-management
description: "Manage the project ontology — entities, relationships, dependencies, architecture"
---

# Ontology Management Skill

## Ontology File Location
`project/ONTOLOGY.md`

## Purpose

The ontology is a living knowledge base of the project. It records:
- What entities exist (files, modules, classes, functions, APIs, configs)
- How they relate to each other (depends on, calls, imports, extends)
- External dependencies (libraries, services, APIs)
- Architecture patterns in use
- Data flow paths

This file survives context compaction and serves as persistent memory.

## Ontology Structure

```markdown
# Project Ontology

> Last updated: [ISO timestamp]
> Project: [name]

## Entities

### Modules
| Module | Path | Purpose | Key Exports |
|--------|------|---------|-------------|
| [name] | [path] | [what it does] | [main exports] |

### Key Files
| File | Type | Purpose | Dependencies |
|------|------|---------|-------------|
| [path] | [source/config/test/doc] | [what it does] | [what it needs] |

### External Dependencies
| Package | Version | Purpose | Used By |
|---------|---------|---------|---------|
| [name] | [ver] | [why needed] | [which modules] |

### APIs / Endpoints
| Endpoint | Method | Handler | Auth | Description |
|----------|--------|---------|------|-------------|
| [path] | [GET/POST/...] | [file:fn] | [yes/no] | [what it does] |

## Relationships

### Dependency Graph (simplified)
```
A → B → C
A → D
D → C
```

### Import Map
| Source | Imports From | What |
|--------|-------------|------|
| [file] | [file] | [symbols] |

### Data Flow
```
User Input → Validation → Service → Repository → Database
                                  → Cache
```

## Patterns

### Architecture Pattern
[e.g., MVC, Clean Architecture, Event-Driven]

### Naming Conventions
- Files: [pattern]
- Classes: [pattern]
- Functions: [pattern]

### Configuration
- Config files: [list]
- Environment variables: [list]

## Discovery Log
| # | Discovered | Entity/Relationship | Context |
|---|-----------|-------------------|---------|
| 1 | [timestamp] | [what was found] | [while doing what] |
```

## Operations

### Add an entity
Read ontology, add to appropriate table, write back.

### Add a relationship
Read ontology, add to Import Map or Dependency Graph, write back.

### Record a discovery
Read ontology, append to Discovery Log, write back.

### Query the ontology
Read ontology, search for the requested information, return it.

## Important Rules

- Update timestamp on every modification
- Keep entries concise — one line per entity
- Use consistent naming (lowercase, dashes for multi-word)
- Remove stale entries when refactoring obsoletes them
- The dependency graph should be kept as ASCII art for readability
