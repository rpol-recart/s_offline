import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const ONTOLOGY_PATH = "project/ONTOLOGY.md"

const ONTOLOGY_TEMPLATE = `# Project Ontology

> Last updated: ${new Date().toISOString()}
> Project: [unnamed]

## Entities

### Modules
| Module | Path | Purpose | Key Exports |
|--------|------|---------|-------------|

### Key Files
| File | Type | Purpose | Dependencies |
|------|------|---------|-------------|

### External Dependencies
| Package | Version | Purpose | Used By |
|---------|---------|---------|---------|

### APIs / Endpoints
| Endpoint | Method | Handler | Auth | Description |
|----------|--------|---------|------|-------------|

## Relationships

### Dependency Graph
\`\`\`
[empty]
\`\`\`

### Import Map
| Source | Imports From | What |
|--------|-------------|------|

### Data Flow
\`\`\`
[to be mapped]
\`\`\`

## Patterns

### Architecture Pattern
Not yet determined

### Naming Conventions
Not yet determined

### Configuration
- Config files: []
- Environment variables: []

## Discovery Log
| # | Discovered | Entity/Relationship | Context |
|---|-----------|-------------------|---------|
`

export const read = tool({
  description: "Read the current project ontology from project/ONTOLOGY.md",
  args: {},
  async execute(_args, context) {
    const path = join(context.directory, ONTOLOGY_PATH)
    if (!existsSync(path)) {
      return "No ontology exists yet. Use ontology_init to create one."
    }
    return readFileSync(path, "utf-8")
  },
})

export const init = tool({
  description: "Initialize a new project ontology",
  args: {
    project_name: tool.schema.string().describe("Name of the project"),
  },
  async execute(args, context) {
    const path = join(context.directory, ONTOLOGY_PATH)
    const content = ONTOLOGY_TEMPLATE.replace("[unnamed]", args.project_name)
    writeFileSync(path, content, "utf-8")
    return `Ontology initialized at ${ONTOLOGY_PATH}`
  },
})

export const update = tool({
  description:
    "Update the full ontology content. Use this for major restructuring.",
  args: {
    content: tool.schema
      .string()
      .describe("Full updated ontology content in Markdown format"),
  },
  async execute(args, context) {
    const path = join(context.directory, ONTOLOGY_PATH)
    const content = args.content.replace(
      /> Last updated:.*$/m,
      `> Last updated: ${new Date().toISOString()}`
    )
    writeFileSync(path, content, "utf-8")
    return `Ontology updated at ${ONTOLOGY_PATH}`
  },
})

export const add_entity = tool({
  description: "Add an entity (module, file, dependency, or endpoint) to the ontology",
  args: {
    entity_type: tool.schema
      .string()
      .describe("Type: 'module', 'file', 'dependency', or 'endpoint'"),
    row: tool.schema
      .string()
      .describe("Table row in pipe-separated format: | col1 | col2 | col3 | col4 |"),
  },
  async execute(args, context) {
    const path = join(context.directory, ONTOLOGY_PATH)
    if (!existsSync(path)) {
      return "Error: No ontology exists. Use ontology_init first."
    }
    let ontology = readFileSync(path, "utf-8")

    const sectionMap: Record<string, string> = {
      module: "### Modules",
      file: "### Key Files",
      dependency: "### External Dependencies",
      endpoint: "### APIs / Endpoints",
    }

    const section = sectionMap[args.entity_type]
    if (!section) {
      return `Error: Unknown entity type '${args.entity_type}'. Use: module, file, dependency, endpoint`
    }

    // Find the section and its table
    const sectionIdx = ontology.indexOf(section)
    if (sectionIdx === -1) {
      return `Error: Section ${section} not found in ontology`
    }

    // Find the next ### or ## heading after this section
    const afterSection = ontology.indexOf("\n###", sectionIdx + section.length)
    const afterSection2 = ontology.indexOf("\n##", sectionIdx + section.length)
    const nextSection = Math.min(
      afterSection > -1 ? afterSection : Infinity,
      afterSection2 > -1 ? afterSection2 : Infinity
    )

    // Insert row before next section
    const insertAt = nextSection === Infinity ? ontology.length : nextSection
    const row = args.row.trim().endsWith("|") ? args.row.trim() : args.row.trim() + " |"
    ontology = ontology.slice(0, insertAt) + "\n" + row + ontology.slice(insertAt)

    ontology = ontology.replace(
      /> Last updated:.*$/m,
      `> Last updated: ${new Date().toISOString()}`
    )
    writeFileSync(path, ontology, "utf-8")
    return `Entity added to ${section}`
  },
})

export const add_relationship = tool({
  description: "Add a relationship entry to the Import Map",
  args: {
    source: tool.schema.string().describe("Source file/module"),
    imports_from: tool.schema.string().describe("Where it imports from"),
    what: tool.schema.string().describe("What symbols are imported"),
  },
  async execute(args, context) {
    const path = join(context.directory, ONTOLOGY_PATH)
    if (!existsSync(path)) {
      return "Error: No ontology exists."
    }
    let ontology = readFileSync(path, "utf-8")

    const row = `| ${args.source} | ${args.imports_from} | ${args.what} |`
    const sectionIdx = ontology.indexOf("### Import Map")
    if (sectionIdx === -1) return "Error: Import Map section not found"

    const nextSection = ontology.indexOf("\n###", sectionIdx + 14)
    const nextSection2 = ontology.indexOf("\n## ", sectionIdx + 14)
    const insertAt = Math.min(
      nextSection > -1 ? nextSection : Infinity,
      nextSection2 > -1 ? nextSection2 : Infinity
    )

    const at = insertAt === Infinity ? ontology.length : insertAt
    ontology = ontology.slice(0, at) + "\n" + row + ontology.slice(at)
    ontology = ontology.replace(
      /> Last updated:.*$/m,
      `> Last updated: ${new Date().toISOString()}`
    )
    writeFileSync(path, ontology, "utf-8")
    return "Relationship added to Import Map"
  },
})

export const log_discovery = tool({
  description: "Log a new discovery to the ontology Discovery Log",
  args: {
    entity_or_relationship: tool.schema
      .string()
      .describe("What was discovered"),
    context_description: tool.schema
      .string()
      .describe("During what activity was this discovered"),
  },
  async execute(args, context) {
    const path = join(context.directory, ONTOLOGY_PATH)
    if (!existsSync(path)) {
      return "Error: No ontology exists."
    }
    let ontology = readFileSync(path, "utf-8")

    // Count existing entries
    const matches = ontology.match(/^\| \d+ \|/gm)
    const nextNum = (matches ? matches.length : 0) + 1
    const timestamp = new Date().toISOString().split("T")[0]

    const row = `| ${nextNum} | ${timestamp} | ${args.entity_or_relationship} | ${args.context_description} |`
    ontology = ontology.trimEnd() + "\n" + row + "\n"
    ontology = ontology.replace(
      /> Last updated:.*$/m,
      `> Last updated: ${new Date().toISOString()}`
    )
    writeFileSync(path, ontology, "utf-8")
    return `Discovery #${nextNum} logged`
  },
})
