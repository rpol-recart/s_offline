import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

export type FlagScope = "global" | "user" | "session"

export interface FeatureFlag {
  id: string
  enabled: boolean
  description: string
  scope: FlagScope
  rollout_percentage: number
  permission: "allow" | "deny"
}

export interface FlagOverrides {
  user?: Record<string, boolean>
  session?: Record<string, boolean>
}

interface FeatureFlagsConfig {
  flags: Record<string, FeatureFlag>
  overrides: FlagOverrides
}

const FLAGS_CONFIG_PATH = ".opencode/feature-flags.json"

// Default flags matching KAIROS patterns
const DEFAULT_FLAGS: Record<string, Omit<FeatureFlag, "id">> = {
  daemon_mode_enabled: {
    enabled: false,
    description: "Enable persistent background daemon mode for agents",
    scope: "global",
    rollout_percentage: 0,
    permission: "deny",
  },
  persistent_agent_threads: {
    enabled: false,
    description: "Allow agents to maintain persistent thread state across sessions",
    scope: "user",
    rollout_percentage: 0,
    permission: "deny",
  },
  async_coding_sessions: {
    enabled: false,
    description: "Enable asynchronous coding sessions that can run in background",
    scope: "session",
    rollout_percentage: 0,
    permission: "deny",
  },
  background_task_queue: {
    enabled: false,
    description: "Enable background task queue for deferred execution",
    scope: "global",
    rollout_percentage: 0,
    permission: "deny",
  },
  multi_workspace_sync: {
    enabled: false,
    description: "Synchronize state across multiple workspaces",
    scope: "user",
    rollout_percentage: 0,
    permission: "deny",
  },
  auto_compact_enabled: {
    enabled: false,
    description: "Automatically compact agent memory when threshold is reached",
    scope: "global",
    rollout_percentage: 0,
    permission: "deny",
  },
  auto_memory_enabled: {
    enabled: false,
    description: "Enable automatic memory management for agents",
    scope: "global",
    rollout_percentage: 0,
    permission: "deny",
  },
  auto_dream_enabled: {
    enabled: false,
    description: "Enable automatic dream/reflection mode for agents",
    scope: "user",
    rollout_percentage: 0,
    permission: "deny",
  },
  ultra_plan_enabled: {
    enabled: false,
    description: "Enable ultra planning mode with enhanced reasoning",
    scope: "user",
    rollout_percentage: 0,
    permission: "deny",
  },
  mcp_integration_enabled: {
    enabled: false,
    description: "Enable Model Context Protocol integrations",
    scope: "global",
    rollout_percentage: 0,
    permission: "deny",
  },
}

function loadFlagsConfig(directory: string): FeatureFlagsConfig {
  const path = join(directory, FLAGS_CONFIG_PATH)
  if (!existsSync(path)) {
    // Initialize with default flags
    const flags: Record<string, FeatureFlag> = {}
    for (const [id, config] of Object.entries(DEFAULT_FLAGS)) {
      flags[id] = { id, ...config }
    }
    return { flags, overrides: {} }
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    const flags: Record<string, FeatureFlag> = {}
    for (const [id, config] of Object.entries(DEFAULT_FLAGS)) {
      flags[id] = { id, ...config }
    }
    return { flags, overrides: {} }
  }
}

function saveFlagsConfig(directory: string, config: FeatureFlagsConfig): void {
  const path = join(directory, FLAGS_CONFIG_PATH)
  const dir = path.substring(0, path.lastIndexOf("/"))
  if (!existsSync(dir)) {
    // Config dir doesn't exist yet, will be created
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8")
}

/**
 * Check if a feature flag is enabled
 */
export const isEnabled = tool({
  description: "Check if a specific feature flag is enabled",
  args: {
    flag_id: tool.schema.string().describe("The flag ID to check"),
    user_id: tool.schema.string().optional().describe("User ID for user-scoped flags"),
    session_id: tool.schema.string().optional().describe("Session ID for session-scoped flags"),
  },
  async execute(args, context) {
    const config = loadFlagsConfig(context.directory)
    const flag = config.flags[args.flag_id]

    if (!flag) {
      return JSON.stringify({ enabled: false, reason: `Flag '${args.flag_id}' not found` }, null, 2)
    }

    // Check user override
    if (flag.scope === "user" && args.user_id) {
      const userOverride = config.overrides.user?.[args.flag_id]
      if (userOverride !== undefined) {
        return JSON.stringify({ enabled: userOverride, reason: "user_override" }, null, 2)
      }
    }

    // Check session override
    if (flag.scope === "session" && args.session_id) {
      const sessionOverride = config.overrides.session?.[args.flag_id]
      if (sessionOverride !== undefined) {
        return JSON.stringify({ enabled: sessionOverride, reason: "session_override" }, null, 2)
      }
    }

    // Check rollout percentage
    if (flag.rollout_percentage < 100) {
      const hash = simpleHash(args.user_id || args.session_id || "default")
      const inRollout = (hash % 100) < flag.rollout_percentage
      if (!inRollout) {
        return JSON.stringify({ enabled: false, reason: "rollout_excluded" }, null, 2)
      }
    }

    return JSON.stringify({
      enabled: flag.enabled,
      reason: flag.enabled ? "global_enabled" : "global_disabled",
    }, null, 2)
  },
})

/**
 * Enable a feature flag
 */
export const enableFlag = tool({
  description: "Enable a specific feature flag",
  args: {
    flag_id: tool.schema.string().describe("The flag ID to enable"),
    scope: tool.schema
      .enum(["global", "user", "session"])
      .optional()
      .describe("Override scope: 'global' updates the flag, 'user' or 'session' creates an override"),
    user_id: tool.schema.string().optional().describe("User ID for user-scoped override"),
    session_id: tool.schema.string().optional().describe("Session ID for session-scoped override"),
  },
  async execute(args, context) {
    const config = loadFlagsConfig(context.directory)
    const flag = config.flags[args.flag_id]

    if (!flag) {
      return JSON.stringify({ success: false, message: `Flag '${args.flag_id}' not found` }, null, 2)
    }

    if (args.scope === "user" && args.user_id) {
      config.overrides.user = config.overrides.user || {}
      config.overrides.user[args.flag_id] = true
      saveFlagsConfig(context.directory, config)
      return JSON.stringify({ success: true, message: `Flag '${args.flag_id}' enabled for user ${args.user_id}` }, null, 2)
    }

    if (args.scope === "session" && args.session_id) {
      config.overrides.session = config.overrides.session || {}
      config.overrides.session[args.flag_id] = true
      saveFlagsConfig(context.directory, config)
      return JSON.stringify({ success: true, message: `Flag '${args.flag_id}' enabled for session ${args.session_id}` }, null, 2)
    }

    // Global enable
    config.flags[args.flag_id].enabled = true
    saveFlagsConfig(context.directory, config)
    return JSON.stringify({ success: true, message: `Flag '${args.flag_id}' enabled globally` }, null, 2)
  },
})

/**
 * Disable a feature flag
 */
export const disableFlag = tool({
  description: "Disable a specific feature flag",
  args: {
    flag_id: tool.schema.string().describe("The flag ID to disable"),
    scope: tool.schema
      .enum(["global", "user", "session"])
      .optional()
      .describe("Override scope: 'global' updates the flag, 'user' or 'session' creates an override"),
    user_id: tool.schema.string().optional().describe("User ID for user-scoped override"),
    session_id: tool.schema.string().optional().describe("Session ID for session-scoped override"),
  },
  async execute(args, context) {
    const config = loadFlagsConfig(context.directory)
    const flag = config.flags[args.flag_id]

    if (!flag) {
      return JSON.stringify({ success: false, message: `Flag '${args.flag_id}' not found` }, null, 2)
    }

    if (args.scope === "user" && args.user_id) {
      config.overrides.user = config.overrides.user || {}
      config.overrides.user[args.flag_id] = false
      saveFlagsConfig(context.directory, config)
      return JSON.stringify({ success: true, message: `Flag '${args.flag_id}' disabled for user ${args.user_id}` }, null, 2)
    }

    if (args.scope === "session" && args.session_id) {
      config.overrides.session = config.overrides.session || {}
      config.overrides.session[args.flag_id] = false
      saveFlagsConfig(context.directory, config)
      return JSON.stringify({ success: true, message: `Flag '${args.flag_id}' disabled for session ${args.session_id}` }, null, 2)
    }

    // Global disable
    config.flags[args.flag_id].enabled = false
    saveFlagsConfig(context.directory, config)
    return JSON.stringify({ success: true, message: `Flag '${args.flag_id}' disabled globally` }, null, 2)
  },
})

/**
 * List all feature flags with their current status
 */
export const listFlags = tool({
  description: "List all feature flags with their current enabled status",
  args: {
    filter: tool.schema
      .enum(["all", "enabled", "disabled"])
      .optional()
      .describe("Filter flags by status"),
    scope: tool.schema
      .enum(["all", "global", "user", "session"])
      .optional()
      .describe("Filter flags by scope"),
  },
  async execute(args, context) {
    const config = loadFlagsConfig(context.directory)
    let flags = Object.values(config.flags)

    if (args.filter === "enabled") {
      flags = flags.filter((f) => f.enabled)
    } else if (args.filter === "disabled") {
      flags = flags.filter((f) => !f.enabled)
    }

    if (args.scope && args.scope !== "all") {
      flags = flags.filter((f) => f.scope === args.scope)
    }

    return JSON.stringify({
      flags: flags.map((f) => ({
        id: f.id,
        enabled: f.enabled,
        description: f.description,
        scope: f.scope,
        rollout_percentage: f.rollout_percentage,
        permission: f.permission,
      })),
      total: flags.length,
    }, null, 2)
  },
})

/**
 * Get the raw flag registry for programmatic access
 */
export const getFlagRegistry = tool({
  description: "Get the raw flag registry for programmatic access",
  args: {},
  async execute(_args, context) {
    const config = loadFlagsConfig(context.directory)
    return JSON.stringify(config.flags, null, 2)
  },
})

// Simple hash for rollout percentage calculation
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash)
}
