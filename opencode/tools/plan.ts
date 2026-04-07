import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const PLAN_PATH = "project/PLAN.md"

const PLAN_TEMPLATE = `# Project Plan

> Last updated: ${new Date().toISOString()}
> Status: NOT_STARTED

## Goal
[To be defined]

## Assumptions
- None yet

## Decision Log
| # | Decision | Rationale | Made By |
|---|----------|-----------|---------|

## Blocked Items
- None
`

export const read = tool({
  description: "Read the current project plan from project/PLAN.md",
  args: {},
  async execute(_args, context) {
    const path = join(context.directory, PLAN_PATH)
    if (!existsSync(path)) {
      return "No plan exists yet. Use plan_update to create one."
    }
    return readFileSync(path, "utf-8")
  },
})

export const update = tool({
  description:
    "Update the project plan. Provide the full updated plan content. The plan tracks all tasks, their status, dependencies, and parallel execution groups.",
  args: {
    content: tool.schema
      .string()
      .describe("Full updated plan content in Markdown format"),
  },
  async execute(args, context) {
    const path = join(context.directory, PLAN_PATH)
    // Inject timestamp
    const content = args.content.replace(
      /> Last updated:.*$/m,
      `> Last updated: ${new Date().toISOString()}`
    )
    writeFileSync(path, content, "utf-8")
    return `Plan updated at ${PLAN_PATH}`
  },
})

export const init = tool({
  description:
    "Initialize a new project plan with the given project name and goal",
  args: {
    project_name: tool.schema.string().describe("Name of the project"),
    goal: tool.schema.string().describe("High-level goal description"),
  },
  async execute(args, context) {
    const path = join(context.directory, PLAN_PATH)
    const content = PLAN_TEMPLATE.replace("# Project Plan", `# Project Plan: ${args.project_name}`)
      .replace("[To be defined]", args.goal)
    writeFileSync(path, content, "utf-8")
    return `Plan initialized at ${PLAN_PATH}`
  },
})

export const add_task = tool({
  description: "Add a single task to the plan under a specified phase",
  args: {
    phase: tool.schema.string().describe("Phase name (e.g., 'Phase 1: Setup')"),
    task_id: tool.schema.string().describe("Task ID (e.g., '1.1')"),
    task_name: tool.schema.string().describe("Short task name"),
    agent: tool.schema.string().describe("Specialist agent to handle this task"),
    description: tool.schema.string().describe("What needs to be done"),
    dependencies: tool.schema
      .string()
      .optional()
      .describe("Comma-separated task IDs this depends on"),
  },
  async execute(args, context) {
    const path = join(context.directory, PLAN_PATH)
    if (!existsSync(path)) {
      return "Error: No plan exists. Use plan_init first."
    }
    let plan = readFileSync(path, "utf-8")

    const taskBlock = `
### Task ${args.task_id}: ${args.task_name}
- **Status**: 🔴 TODO
- **Agent**: ${args.agent}
- **Dependencies**: ${args.dependencies || "none"}
- **Description**: ${args.description}
- **Result**: pending
`

    // Try to find the phase section and append
    const phaseRegex = new RegExp(`(## ${args.phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`)
    if (phaseRegex.test(plan)) {
      // Find next ## heading or end of file
      const phaseMatch = plan.match(phaseRegex)
      if (phaseMatch && phaseMatch.index !== undefined) {
        const afterPhase = plan.indexOf("\n## ", phaseMatch.index + 1)
        if (afterPhase > -1) {
          plan = plan.slice(0, afterPhase) + taskBlock + "\n" + plan.slice(afterPhase)
        } else {
          plan += taskBlock
        }
      }
    } else {
      // Phase doesn't exist, create it
      plan += `\n## ${args.phase}\n${taskBlock}`
    }

    plan = plan.replace(
      /> Last updated:.*$/m,
      `> Last updated: ${new Date().toISOString()}`
    )
    writeFileSync(path, plan, "utf-8")
    return `Task ${args.task_id} added to ${args.phase}`
  },
})

export const update_task_status = tool({
  description: "Update the status of a specific task in the plan",
  args: {
    task_id: tool.schema.string().describe("Task ID (e.g., '1.1')"),
    status: tool.schema
      .string()
      .describe("New status: TODO, IN_PROGRESS, DONE, DELEGATED, BLOCKED, FAILED"),
    result: tool.schema
      .string()
      .optional()
      .describe("Result or output of the task (for DONE/FAILED)"),
  },
  async execute(args, context) {
    const path = join(context.directory, PLAN_PATH)
    if (!existsSync(path)) {
      return "Error: No plan exists."
    }
    let plan = readFileSync(path, "utf-8")

    const statusEmoji: Record<string, string> = {
      TODO: "🔴 TODO",
      IN_PROGRESS: "🟡 IN_PROGRESS",
      DONE: "🟢 DONE",
      DELEGATED: "🔵 DELEGATED",
      BLOCKED: "⛔ BLOCKED",
      FAILED: "❌ FAILED",
    }

    const emoji = statusEmoji[args.status.toUpperCase()] || args.status

    // Find task section
    const taskRegex = new RegExp(
      `(### Task ${args.task_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*\\n)([\\s\\S]*?)(?=### Task|## |$)`
    )
    const match = plan.match(taskRegex)
    if (!match) {
      return `Error: Task ${args.task_id} not found in plan`
    }

    let taskSection = match[2]
    taskSection = taskSection.replace(
      /- \*\*Status\*\*:.*$/m,
      `- **Status**: ${emoji}`
    )
    if (args.result) {
      taskSection = taskSection.replace(
        /- \*\*Result\*\*:.*$/m,
        `- **Result**: ${args.result}`
      )
    }

    plan = plan.replace(match[2], taskSection)
    plan = plan.replace(
      /> Last updated:.*$/m,
      `> Last updated: ${new Date().toISOString()}`
    )
    writeFileSync(path, plan, "utf-8")
    return `Task ${args.task_id} updated to ${args.status}`
  },
})
