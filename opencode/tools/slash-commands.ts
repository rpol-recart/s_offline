import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

// ============================================================================
// Types
// ============================================================================

export type CommandCategory = "session" | "system" | "context" | "task"

export interface CommandResult {
  success: boolean
  output?: string
  error?: string
  data?: unknown
}

export interface SlashCommand {
  name: string
  aliases?: string[]
  description: string
  usage?: string
  permission?: string
  category: CommandCategory
  handler: (args: string[], context: CommandContext) => CommandResult
}

export interface CommandContext {
  directory: string
  sessionId?: string
  model?: string
  tokenCount?: number
  costEstimate?: number
}

// ============================================================================
// Command Registry
// ============================================================================

class CommandRegistry {
  private commands: Map<string, SlashCommand> = new Map()
  private aliases: Map<string, string> = new Map() // alias -> command name

  register(command: SlashCommand): void {
    this.commands.set(command.name, command)
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name)
      }
    }
  }

  get(name: string): SlashCommand | undefined {
    // Try direct lookup
    let cmd = this.commands.get(name)
    // Try alias resolution
    if (!cmd) {
      const resolvedName = this.aliases.get(name)
      if (resolvedName) {
        cmd = this.commands.get(resolvedName)
      }
    }
    return cmd
  }

  getAll(): SlashCommand[] {
    return Array.from(this.commands.values())
  }

  getByCategory(category: CommandCategory): SlashCommand[] {
    return this.getAll().filter((cmd) => cmd.category === category)
  }

  list(): { name: string; aliases: string[]; description: string; category: CommandCategory }[] {
    return this.getAll().map((cmd) => ({
      name: cmd.name,
      aliases: cmd.aliases || [],
      description: cmd.description,
      category: cmd.category,
    }))
  }

  has(name: string): boolean {
    return this.commands.has(name) || this.aliases.has(name)
  }
}

// Global registry instance
export const registry = new CommandRegistry()

// ============================================================================
// REPL Parser
// ============================================================================

export interface ParsedCommand {
  command: string
  args: string[]
  raw: string
}

export function parseSlashCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim()

  // Must start with /
  if (!trimmed.startsWith("/")) {
    return null
  }

  // Find command name (first word after /)
  const withoutSlash = trimmed.slice(1)
  const parts = withoutSlash.split(/\s+/)
  const command = parts[0].toLowerCase()
  const args = parts.slice(1)

  // Handle commands that might have subcommands in args
  // e.g., /session list -> args = ["list"]
  return {
    command,
    args,
    raw: trimmed,
  }
}

export function executeCommand(
  input: string,
  context: CommandContext
): CommandResult {
  const parsed = parseSlashCommand(input)

  if (!parsed) {
    return {
      success: false,
      error: "Invalid command format. Commands must start with /",
    }
  }

  const command = registry.get(parsed.command)

  if (!command) {
    return {
      success: false,
      error: `Unknown command: /${parsed.command}. Type /help for available commands.`,
    }
  }

  try {
    return command.handler(parsed.args, context)
  } catch (error: any) {
    return {
      success: false,
      error: `Command failed: ${error.message}`,
    }
  }
}

// ============================================================================
// Help Generator
// ============================================================================

export function generateHelpText(category?: CommandCategory): string {
  const commands = category ? registry.getByCategory(category) : registry.getAll()

  const lines: string[] = []
  lines.push("Available Commands:")
  lines.push("===================")

  // Group by category if showing all
  if (!category) {
    const categories: Record<CommandCategory, SlashCommand[]> = {
      session: [],
      system: [],
      context: [],
      task: [],
    }

    for (const cmd of commands) {
      categories[cmd.category].push(cmd)
    }

    for (const [cat, cmds] of Object.entries(categories)) {
      if (cmds.length > 0) {
        lines.push(`\n[${cat.toUpperCase()}]`)
        for (const c of cmds) {
          const aliasText = c.aliases ? ` (alias: ${c.aliases.map((a) => `/${a}`).join(", ")})` : ""
          lines.push(`  /${c.name}${c.usage ? ` ${c.usage}` : ""} - ${c.description}${aliasText}`)
        }
      }
    }
  } else {
    for (const cmd of commands) {
      const aliasText = cmd.aliases ? ` (alias: ${cmd.aliases.map((a) => `/${a}`).join(", ")})` : ""
      lines.push(`  /${cmd.name}${cmd.usage ? ` ${cmd.usage}` : ""} - ${cmd.description}${aliasText}`)
    }
  }

  lines.push("\nType /help [category] for detailed help on a category.")
  return lines.join("\n")
}

// ============================================================================
// Built-in Commands
// ============================================================================

// ---- /help ----
registry.register({
  name: "help",
  aliases: ["h", "?"],
  description: "List all available commands or get help for a specific category",
  usage: "[category]",
  category: "system",
  handler: (args) => {
    const category = args[0] as CommandCategory | undefined
    if (category && !["session", "system", "context", "task"].includes(category)) {
      return {
        success: false,
        error: `Invalid category: ${category}. Valid categories: session, system, context, task`,
      }
    }
    return {
      success: true,
      output: generateHelpText(category),
    }
  },
})

// ---- /compact ----
registry.register({
  name: "compact",
  aliases: ["compress", "shrink"],
  description: "Compact the current context to reduce token usage",
  usage: "[reason]",
  category: "context",
  handler: (args) => {
    const reason = args.join(" ") || "Manual compaction triggered"
    return {
      success: true,
      output: `Context compaction initiated: ${reason}`,
      data: {
        action: "compact",
        reason,
        triggeredAt: new Date().toISOString(),
      },
    }
  },
})

// ---- /model ----
registry.register({
  name: "model",
  aliases: ["m"],
  description: "Switch model or view current model",
  usage: "[model_name]",
  category: "system",
  handler: (args, context) => {
    if (args.length === 0) {
      return {
        success: true,
        output: `Current model: ${context.model || "default"}`,
        data: { currentModel: context.model || "default" },
      }
    }

    const newModel = args[0]
    return {
      success: true,
      output: `Model switched to: ${newModel}`,
      data: {
        action: "model_switch",
        previousModel: context.model || "default",
        newModel,
      },
    }
  },
})

// ---- /permissions ----
registry.register({
  name: "permissions",
  aliases: ["perms", "perm"],
  description: "Manage tool permissions",
  usage: "[list|enable|disable] [tool]",
  category: "system",
  handler: (args) => {
    if (args.length === 0 || args[0] === "list") {
      return {
        success: true,
        output: "Permission management - use /permissions [enable|disable] [tool]",
        data: { action: "list" },
      }
    }

    const action = args[0]
    const tool = args[1]

    if (!["enable", "disable"].includes(action)) {
      return {
        success: false,
        error: `Invalid action: ${action}. Use: list, enable, disable`,
      }
    }

    if (!tool) {
      return {
        success: false,
        error: "Tool name required",
      }
    }

    return {
      success: true,
      output: `Permission ${action}d for: ${tool}`,
      data: { action, tool },
    }
  },
})

// ---- /cost ----
registry.register({
  name: "cost",
  aliases: ["tokens", "usage"],
  description: "View token usage and cost estimates",
  usage: "[reset]",
  category: "system",
  handler: (args, context) => {
    if (args[0] === "reset") {
      return {
        success: true,
        output: "Cost tracking reset",
        data: { action: "reset" },
      }
    }

    const tokens = context.tokenCount || 0
    const cost = context.costEstimate || 0

    return {
      success: true,
      output: `Token Usage Report\n==================\nTokens: ${tokens.toLocaleString()}\nEstimated Cost: $${cost.toFixed(4)}`,
      data: {
        tokens,
        cost,
        currency: "USD",
      },
    }
  },
})

// ---- /session ----
registry.register({
  name: "session",
  aliases: ["sess"],
  description: "Session management - list, switch, delete, or info",
  usage: "[list|switch|delete|info] [session_id]",
  category: "session",
  handler: (args, context) => {
    const subcommand = args[0] || "info"
    const sessionId = args[1]

    switch (subcommand) {
      case "list":
        return {
          success: true,
          output: "Listing all sessions...",
          data: { action: "list" },
        }

      case "switch":
        if (!sessionId) {
          return {
            success: false,
            error: "Session ID required: /session switch [session_id]",
          }
        }
        return {
          success: true,
          output: `Switched to session: ${sessionId}`,
          data: { action: "switch", sessionId },
        }

      case "delete":
        if (!sessionId) {
          return {
            success: false,
            error: "Session ID required: /session delete [session_id]",
          }
        }
        return {
          success: true,
          output: `Deleted session: ${sessionId}`,
          data: { action: "delete", sessionId },
        }

      case "info":
        return {
          success: true,
          output: `Current session: ${context.sessionId || "none"}`,
          data: {
            action: "info",
            currentSession: context.sessionId,
          },
        }

      default:
        return {
          success: false,
          error: `Unknown subcommand: ${subcommand}. Use: list, switch, delete, info`,
        }
    }
  },
})

// ---- /status ----
registry.register({
  name: "status",
  aliases: ["stats", "info"],
  description: "Show daemon and queue status",
  usage: "[detailed]",
  category: "system",
  handler: (args) => {
    const detailed = args[0] === "detailed"

    // Load daemon state if available
    let daemonState = { state: "unknown", uptime: 0 }
    let queueStats = { total: 0, queued: 0, processing: 0 }

    try {
      const daemonPath = join(process.cwd(), ".opencode/daemon-state.json")
      if (existsSync(daemonPath)) {
        const daemonData = JSON.parse(readFileSync(daemonPath, "utf-8"))
        daemonState = {
          state: daemonData.status?.state || "unknown",
          uptime: daemonData.status?.uptime || 0,
        }
      }
    } catch {}

    try {
      const queuePath = join(process.cwd(), ".opencode/task-queue/queue.json")
      if (existsSync(queuePath)) {
        const queueData = JSON.parse(readFileSync(queuePath, "utf-8"))
        const tasks = queueData.tasks || []
        queueStats = {
          total: tasks.length,
          queued: tasks.filter((t: any) => t.status === "queued").length,
          processing: tasks.filter((t: any) => t.status === "processing").length,
        }
      }
    } catch {}

    const lines = [
      "System Status",
      "=============",
      `Daemon: ${daemonState.state}`,
      `Uptime: ${Math.floor(daemonState.uptime / 1000)}s`,
      "",
      "Task Queue",
      "==========",
      `Total: ${queueStats.total}`,
      `Queued: ${queueStats.queued}`,
      `Processing: ${queueStats.processing}`,
    ]

    return {
      success: true,
      output: lines.join("\n"),
      data: {
        daemon: daemonState,
        queue: queueStats,
      },
    }
  },
})

// ---- /flags ----
registry.register({
  name: "flags",
  aliases: ["feature-flags", "ff"],
  description: "Feature flags management - list, enable, or disable flags",
  usage: "[list|enable|disable] [flag_id]",
  category: "system",
  handler: (args) => {
    if (args.length === 0 || args[0] === "list") {
      // Load flags from feature-flags.json
      let flags: any = {}
      try {
        const flagsPath = join(process.cwd(), ".opencode/feature-flags.json")
        if (existsSync(flagsPath)) {
          const data = JSON.parse(readFileSync(flagsPath, "utf-8"))
          flags = data.flags || {}
        }
      } catch {}

      const flagList = Object.entries(flags)
        .map(([id, f]: [string, any]) => `  ${id}: ${f.enabled ? "ON" : "OFF"}`)
        .join("\n")

      return {
        success: true,
        output: `Feature Flags\n=============\n${flagList || "  No flags configured"}`,
        data: { action: "list", flags },
      }
    }

    const action = args[0]
    const flagId = args[1]

    if (!["enable", "disable"].includes(action)) {
      return {
        success: false,
        error: `Invalid action: ${action}. Use: list, enable, disable`,
      }
    }

    if (!flagId) {
      return {
        success: false,
        error: "Flag ID required",
      }
    }

    return {
      success: true,
      output: `${action}d flag: ${flagId}`,
      data: { action, flagId },
    }
  },
})

// ---- /logs ----
registry.register({
  name: "logs",
  aliases: ["log", "events"],
  description: "View append-log entries",
  usage: "[type] [limit]",
  category: "system",
  handler: (args) => {
    const logType = args[0] || "all"
    const limit = parseInt(args[1]) || 50

    // Load logs
    let entries: any[] = []
    try {
      const logPath = join(process.cwd(), ".opencode/logs/append.log")
      if (existsSync(logPath)) {
        const content = readFileSync(logPath, "utf-8")
        const lines = content.split("\n").filter(Boolean)
        entries = lines
          .slice(-limit)
          .map((line) => {
            try {
              return JSON.parse(line)
            } catch {
              return null
            }
          })
          .filter(Boolean)
          .reverse()
      }
    } catch {}

    if (logType !== "all") {
      entries = entries.filter((e) => e.type === logType)
    }

    const output = entries
      .slice(0, limit)
      .map((e) => `[${e.timestamp}] ${e.type}: ${e.message}`)
      .join("\n")

    return {
      success: true,
      output: output || "No log entries",
      data: {
        action: "view",
        logType,
        count: entries.length,
      },
    }
  },
})

// ---- /queue ----
registry.register({
  name: "queue",
  aliases: ["tasks", "q"],
  description: "Task queue management - list, clear, or stats",
  usage: "[list|clear|stats] [task_id]",
  category: "task",
  handler: (args) => {
    const subcommand = args[0] || "stats"

    switch (subcommand) {
      case "list":
      case "stats": {
        // Load queue data
        let queueData = { tasks: [] }
        try {
          const queuePath = join(process.cwd(), ".opencode/task-queue/queue.json")
          if (existsSync(queuePath)) {
            queueData = JSON.parse(readFileSync(queuePath, "utf-8"))
          }
        } catch {}

        const tasks = queueData.tasks || []
        const byStatus = {
          queued: tasks.filter((t: any) => t.status === "queued").length,
          processing: tasks.filter((t: any) => t.status === "processing").length,
          completed: tasks.filter((t: any) => t.status === "completed").length,
          failed: tasks.filter((t: any) => t.status === "failed").length,
        }

        return {
          success: true,
          output: `Queue Statistics\n================\nTotal: ${tasks.length}\nQueued: ${byStatus.queued}\nProcessing: ${byStatus.processing}\nCompleted: ${byStatus.completed}\nFailed: ${byStatus.failed}`,
          data: { action: "stats", ...byStatus, total: tasks.length },
        }
      }

      case "clear":
        return {
          success: true,
          output: "Queue cleared",
          data: { action: "clear" },
        }

      default:
        return {
          success: false,
          error: `Unknown subcommand: ${subcommand}. Use: list, clear, stats`,
        }
    }
  },
})

// ---- /clear ----
registry.register({
  name: "clear",
  aliases: ["cl"],
  description: "Clear the current context (messages, but preserve session)",
  usage: "[confirm]",
  category: "session",
  handler: (args) => {
    const confirm = args[0] === "confirm"

    if (!confirm) {
      return {
        success: false,
        error: "Use /clear confirm to clear context",
      }
    }

    return {
      success: true,
      output: "Context cleared. Session preserved.",
      data: {
        action: "clear",
        confirmed: true,
      },
    }
  },
})

// ---- /exit ----
registry.register({
  name: "exit",
  aliases: ["quit", "q", "bye"],
  description: "Exit gracefully, saving session state",
  usage: "[force]",
  category: "session",
  handler: (args) => {
    const force = args[0] === "force"

    return {
      success: true,
      output: force
        ? "Exiting immediately..."
        : "Graceful exit initiated. Saving session state...",
      data: {
        action: "exit",
        graceful: !force,
      },
    }
  },
})

// ============================================================================
// Tool Exports (for OpenCode integration)
// ============================================================================

export const slashHelp = tool({
  description: "Get help about available slash commands",
  args: {
    category: tool.schema
      .enum(["session", "system", "context", "task"])
      .optional()
      .describe("Filter help by category"),
  },
  async execute(args) {
    return generateHelpText(args.category)
  },
})

export const slashExecute = tool({
  description: "Execute a slash command",
  args: {
    command: tool.schema.string().describe("The slash command to execute (e.g., '/help')"),
    model: tool.schema.string().optional().describe("Current model name"),
    token_count: tool.schema.number().optional().describe("Current token count"),
    cost_estimate: tool.schema.number().optional().describe("Current cost estimate"),
  },
  async execute(args, context) {
    const cmdContext: CommandContext = {
      directory: context.directory,
      model: args.model,
      tokenCount: args.token_count,
      costEstimate: args.cost_estimate,
    }

    const result = executeCommand(args.command, cmdContext)

    return JSON.stringify(result)
  },
})

export const slashList = tool({
  description: "List all registered slash commands",
  args: {
    category: tool.schema
      .enum(["session", "system", "context", "task"])
      .optional()
      .describe("Filter by category"),
  },
  async execute(args) {
    const commands = args.category
      ? registry.getByCategory(args.category as CommandCategory)
      : registry.getAll()

    return JSON.stringify({
      commands: commands.map((cmd) => ({
        name: cmd.name,
        aliases: cmd.aliases,
        description: cmd.description,
        usage: cmd.usage,
        category: cmd.category,
      })),
      total: commands.length,
    })
  },
})

// All tools and utilities are exported at their declaration site above.
