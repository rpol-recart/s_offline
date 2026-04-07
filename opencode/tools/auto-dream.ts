import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs"
import { join } from "path"

// ============================================================================
// Types & Interfaces
// ============================================================================

export type ConsolidationState = "idle" | "detecting" | "consolidating" | "paused"

export interface ConsolidationConfig {
  idleTimeoutMinutes: number
  minActivityThreshold: number
  stalenessThresholdDays: number
  frequencyThreshold: number
  maxEntriesPerConsolidation: number
  enableAutoTrigger: boolean
}

export interface MemoryPattern {
  id: string
  type: "file_access" | "task_pattern" | "concept" | "context_entry"
  key: string
  frequency: number
  lastSeen: string
  relevance: number
  strength: number
}

export interface ConsolidationResult {
  id: string
  timestamp: string
  duration: number
  entriesProcessed: number
  patternsIdentified: number
  conceptsStrengthened: number
  staleEntriesPruned: number
  contextEntriesUpdated: number
  summary: string
}

export interface IdleStatus {
  isIdle: boolean
  lastActivityTime: string | null
  idleDurationMinutes: number
  pendingActivities: number
}

export interface AutoDreamStatus {
  enabled: boolean
  state: ConsolidationState
  config: ConsolidationConfig
  idleStatus: IdleStatus
  lastConsolidation: ConsolidationResult | null
  nextScheduledConsolidation: string | null
}

// ============================================================================
// Constants
// ============================================================================

const AUTO_DREAM_DIR = ".opencode/auto-dream"
const RESULTS_DIR = ".opencode/auto-dream/results"
const PATTERNS_FILE = ".opencode/auto-dream/patterns.json"
const CONFIG_FILE = ".opencode/auto-dream/config.json"
const STATUS_FILE = ".opencode/auto-dream/status.json"
const LAST_ACTIVITY_FILE = ".opencode/auto-dream/last-activity.json"

const DEFAULT_CONFIG: ConsolidationConfig = {
  idleTimeoutMinutes: 5,
  minActivityThreshold: 10,
  stalenessThresholdDays: 7,
  frequencyThreshold: 3,
  maxEntriesPerConsolidation: 1000,
  enableAutoTrigger: true,
}

// ============================================================================
// Helper Functions
// ============================================================================

function getAutoDreamPaths(context: { directory: string }) {
  return {
    autoDreamDir: join(context.directory, AUTO_DREAM_DIR),
    resultsDir: join(context.directory, RESULTS_DIR),
    patternsPath: join(context.directory, PATTERNS_FILE),
    configPath: join(context.directory, CONFIG_FILE),
    statusPath: join(context.directory, STATUS_FILE),
    lastActivityPath: join(context.directory, LAST_ACTIVITY_FILE),
  }
}

function ensureDirectories(paths: ReturnType<typeof getAutoDreamPaths>): void {
  if (!existsSync(paths.autoDreamDir)) {
    mkdirSync(paths.autoDreamDir, { recursive: true })
  }
  if (!existsSync(paths.resultsDir)) {
    mkdirSync(paths.resultsDir, { recursive: true })
  }
}

function loadPatterns(context: { directory: string }): MemoryPattern[] {
  const paths = getAutoDreamPaths(context)
  if (!existsSync(paths.patternsPath)) {
    return []
  }
  try {
    return JSON.parse(readFileSync(paths.patternsPath, "utf-8"))
  } catch {
    return []
  }
}

function savePatterns(context: { directory: string }, patterns: MemoryPattern[]): void {
  const paths = getAutoDreamPaths(context)
  writeFileSync(paths.patternsPath, JSON.stringify(patterns, null, 2), "utf-8")
}

function loadConfig(context: { directory: string }): ConsolidationConfig {
  const paths = getAutoDreamPaths(context)
  if (!existsSync(paths.configPath)) {
    return { ...DEFAULT_CONFIG }
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(paths.configPath, "utf-8")) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(context: { directory: string }, config: ConsolidationConfig): void {
  const paths = getAutoDreamPaths(context)
  ensureDirectories(paths)
  writeFileSync(paths.configPath, JSON.stringify(config, null, 2), "utf-8")
}

function loadStatus(context: { directory: string }): { state: ConsolidationState; lastConsolidationId: string | null } {
  const paths = getAutoDreamPaths(context)
  if (!existsSync(paths.statusPath)) {
    return { state: "idle", lastConsolidationId: null }
  }
  try {
    return JSON.parse(readFileSync(paths.statusPath, "utf-8"))
  } catch {
    return { state: "idle", lastConsolidationId: null }
  }
}

function saveStatus(context: { directory: string }, status: { state: ConsolidationState; lastConsolidationId: string | null }): void {
  const paths = getAutoDreamPaths(context)
  writeFileSync(paths.statusPath, JSON.stringify(status, null, 2), "utf-8")
}

function loadLastActivity(context: { directory: string }): { timestamp: string | null; pendingActivities: number } {
  const paths = getAutoDreamPaths(context)
  if (!existsSync(paths.lastActivityPath)) {
    return { timestamp: null, pendingActivities: 0 }
  }
  try {
    return JSON.parse(readFileSync(paths.lastActivityPath, "utf-8"))
  } catch {
    return { timestamp: null, pendingActivities: 0 }
  }
}

function saveLastActivity(context: { directory: string }, activity: { timestamp: string | null; pendingActivities: number }): void {
  const paths = getAutoDreamPaths(context)
  writeFileSync(paths.lastActivityPath, JSON.stringify(activity), "utf-8")
}

function saveConsolidationResult(context: { directory: string }, result: ConsolidationResult): void {
  const paths = getAutoDreamPaths(context)
  ensureDirectories(paths)
  const resultPath = join(paths.resultsDir, `${result.id}.json`)
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8")
}

function getLastConsolidationResult(context: { directory: string }): ConsolidationResult | null {
  const paths = getAutoDreamPaths(context)
  if (!existsSync(paths.resultsDir)) {
    return null
  }
  const files = readdirSync(paths.resultsDir).filter(f => f.endsWith(".json")).sort().reverse()
  if (files.length === 0) {
    return null
  }
  try {
    return JSON.parse(readFileSync(join(paths.resultsDir, files[0]), "utf-8"))
  } catch {
    return null
  }
}

function isAutoDreamEnabled(context: { directory: string }): boolean {
  try {
    const flagsPath = join(context.directory, ".opencode/feature-flags.json")
    if (!existsSync(flagsPath)) {
      return false
    }
    const flagsData = JSON.parse(readFileSync(flagsPath, "utf-8"))
    return flagsData.flags?.auto_dream_enabled?.enabled === true
  } catch {
    return false
  }
}

// ============================================================================
// Memory Analysis Functions
// ============================================================================

function analyzeFileAccessPatterns(logEntries: any[]): MemoryPattern[] {
  const fileAccessMap = new Map<string, number>()
  
  for (const entry of logEntries) {
    if (entry.type === "task" && entry.metadata?.file) {
      const file = entry.metadata.file
      fileAccessMap.set(file, (fileAccessMap.get(file) || 0) + 1)
    }
  }
  
  const patterns: MemoryPattern[] = []
  for (const [file, frequency] of fileAccessMap) {
    patterns.push({
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: "file_access",
      key: file,
      frequency,
      lastSeen: new Date().toISOString(),
      relevance: Math.min(frequency / 10, 1),
      strength: 0.5,
    })
  }
  
  return patterns
}

function analyzeTaskPatterns(logEntries: any[]): MemoryPattern[] {
  const taskTypeMap = new Map<string, number>()
  
  for (const entry of logEntries) {
    if (entry.type === "task" && entry.metadata?.taskType) {
      const taskType = entry.metadata.taskType
      taskTypeMap.set(taskType, (taskTypeMap.get(taskType) || 0) + 1)
    }
  }
  
  const patterns: MemoryPattern[] = []
  for (const [taskType, frequency] of taskTypeMap) {
    patterns.push({
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: "task_pattern",
      key: taskType,
      frequency,
      lastSeen: new Date().toISOString(),
      relevance: Math.min(frequency / 5, 1),
      strength: 0.5,
    })
  }
  
  return patterns
}

function calculateStaleness(lastSeen: string, thresholdDays: number): number {
  const daysSince = (Date.now() - new Date(lastSeen).getTime()) / (1000 * 60 * 60 * 24)
  return Math.min(daysSince / thresholdDays, 1)
}

function pruneStaleEntries(patterns: MemoryPattern[], thresholdDays: number): MemoryPattern[] {
  return patterns.filter(p => calculateStaleness(p.lastSeen, thresholdDays) < 1)
}

function strengthenFrequentConcepts(patterns: MemoryPattern[], frequencyThreshold: number): MemoryPattern[] {
  return patterns.map(p => ({
    ...p,
    strength: p.frequency >= frequencyThreshold ? Math.min(p.strength + 0.1, 1) : p.strength,
  }))
}

// ============================================================================
// Tools
// ============================================================================

/**
 * Check if the agent is currently idle
 */
export const getIdleStatus = tool({
  description: "Check the current idle status of the agent. Returns information about last activity time, idle duration, and pending activities.",
  args: {},
  async execute(_args, context) {
    const config = loadConfig(context)
    const lastActivity = loadLastActivity(context)
    
    let idleDurationMinutes = 0
    let isIdle = false
    
    if (lastActivity.timestamp) {
      idleDurationMinutes = (Date.now() - new Date(lastActivity.timestamp).getTime()) / (1000 * 60)
      isIdle = idleDurationMinutes >= config.idleTimeoutMinutes
    } else {
      // No activity recorded yet - consider idle if auto trigger is enabled
      isIdle = config.enableAutoTrigger
    }
    
    return JSON.stringify({
      isIdle,
      lastActivityTime: lastActivity.timestamp,
      idleDurationMinutes: Math.round(idleDurationMinutes * 100) / 100,
      pendingActivities: lastActivity.pendingActivities,
      idleThresholdMinutes: config.idleTimeoutMinutes,
    } as IdleStatus, null, 2)
  },
})

/**
 * Record activity (called by other components to track agent activity)
 */
export const recordActivity = tool({
  description: "Record an activity event to track agent idle time. Call this when the agent performs work.",
  args: {
    activityType: tool.schema.string().optional().describe("Type of activity (e.g., 'task', 'read', 'write')"),
  },
  async execute(args, context) {
    const lastActivity = loadLastActivity(context)
    
    saveLastActivity(context, {
      timestamp: new Date().toISOString(),
      pendingActivities: lastActivity.pendingActivities + 1,
    })
    
    return JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      activityType: args.activityType || "general",
    }, null, 2)
  },
})

/**
 * Mark pending activity as completed
 */
export const clearActivity = tool({
  description: "Clear a pending activity when work is completed. Call this when a task is finished to properly track idle state.",
  args: {},
  async execute(_args, context) {
    const lastActivity = loadLastActivity(context)
    
    if (lastActivity.pendingActivities > 0) {
      saveLastActivity(context, {
        timestamp: lastActivity.timestamp,
        pendingActivities: lastActivity.pendingActivities - 1,
      })
    }
    
    return JSON.stringify({
      success: true,
      remainingActivities: Math.max(0, lastActivity.pendingActivities - 1),
    }, null, 2)
  },
})

/**
 * Start memory consolidation manually
 */
export const startConsolidation = tool({
  description: "Manually trigger memory consolidation. This will analyze recent activity from the append log, identify patterns, strengthen frequently used concepts, and prune stale entries.",
  args: {},
  async execute(_args, context) {
    const paths = getAutoDreamPaths(context)
    
    if (!isAutoDreamEnabled(context)) {
      return JSON.stringify({
        success: false,
        message: "auto_dream_enabled feature flag is not enabled",
      }, null, 2)
    }

    const startTime = Date.now()
    
    // Update state to consolidating
    saveStatus(context, { state: "consolidating", lastConsolidationId: null })
    
    // Load append log entries (last 1000)
    let logEntries: any[] = []
    try {
      const logPath = join(context.directory, ".opencode/logs/append.log")
      if (existsSync(logPath)) {
        const content = readFileSync(logPath, "utf-8")
        const lines = content.split("\n").filter(line => line.trim())
        for (const line of lines.slice(-1000)) {
          try {
            logEntries.push(JSON.parse(line))
          } catch {}
        }
      }
    } catch {}
    
    const config = loadConfig(context)
    
    // Analyze patterns
    const filePatterns = analyzeFileAccessPatterns(logEntries)
    const taskPatterns = analyzeTaskPatterns(logEntries)
    
    // Load existing patterns
    const existingPatterns = loadPatterns(context)
    
    // Merge patterns
    const mergedPatterns = [...existingPatterns]
    for (const newPattern of [...filePatterns, ...taskPatterns]) {
      const existingIndex = mergedPatterns.findIndex(p => p.key === newPattern.key && p.type === newPattern.type)
      if (existingIndex >= 0) {
        // Update existing pattern
        mergedPatterns[existingIndex] = {
          ...mergedPatterns[existingIndex],
          frequency: mergedPatterns[existingIndex].frequency + newPattern.frequency,
          lastSeen: newPattern.lastSeen,
        }
      } else {
        mergedPatterns.push(newPattern)
      }
    }
    
    // Strengthen frequent concepts
    const strengthenedPatterns = strengthenFrequentConcepts(mergedPatterns, config.frequencyThreshold)
    
    // Prune stale entries
    const activePatterns = pruneStaleEntries(strengthenedPatterns, config.stalenessThresholdDays)
    
    // Limit patterns
    const limitedPatterns = activePatterns.slice(-config.maxEntriesPerConsolidation)
    
    // Save patterns
    savePatterns(context, limitedPatterns)
    
    const duration = Date.now() - startTime
    
    // Create result
    const result: ConsolidationResult = {
      id: `consolidation_${Date.now()}`,
      timestamp: new Date().toISOString(),
      duration,
      entriesProcessed: logEntries.length,
      patternsIdentified: filePatterns.length + taskPatterns.length,
      conceptsStrengthened: strengthenedPatterns.length - mergedPatterns.length,
      staleEntriesPruned: mergedPatterns.length - activePatterns.length,
      contextEntriesUpdated: limitedPatterns.length,
      summary: `Processed ${logEntries.length} log entries, identified ${filePatterns.length + taskPatterns.length} patterns, ${activePatterns.length} active patterns retained`,
    }
    
    // Save result
    saveConsolidationResult(context, result)
    
    // Update status
    saveStatus(context, { state: "idle", lastConsolidationId: result.id })
    
    return JSON.stringify({
      success: true,
      result,
      patternsRetained: limitedPatterns.length,
    }, null, 2)
  },
})

/**
 * Get consolidation status
 */
export const getConsolidationStatus = tool({
  description: "Check if consolidation is currently running or the current state of the auto-dream service.",
  args: {},
  async execute(_args, context) {
    const enabled = isAutoDreamEnabled(context)
    const status = loadStatus(context)
    const config = loadConfig(context)
    const lastActivity = loadLastActivity(context)
    
    // Calculate idle status
    let idleDurationMinutes = 0
    let isIdle = false
    
    if (lastActivity.timestamp) {
      idleDurationMinutes = (Date.now() - new Date(lastActivity.timestamp).getTime()) / (1000 * 60)
      isIdle = idleDurationMinutes >= config.idleTimeoutMinutes && lastActivity.pendingActivities === 0
    }
    
    const lastResult = getLastConsolidationResult(context)
    
    // Calculate next scheduled consolidation
    let nextScheduled: string | null = null
    if (enabled && lastResult) {
      const nextTime = new Date(lastResult.timestamp).getTime() + config.idleTimeoutMinutes * 60 * 1000
      nextScheduled = new Date(nextTime).toISOString()
    }
    
    return JSON.stringify({
      enabled,
      state: status.state,
      config,
      idleStatus: {
        isIdle,
        lastActivityTime: lastActivity.timestamp,
        idleDurationMinutes: Math.round(idleDurationMinutes * 100) / 100,
        pendingActivities: lastActivity.pendingActivities,
      },
      lastConsolidation: lastResult,
      nextScheduledConsolidation: nextScheduled,
    } as AutoDreamStatus, null, 2)
  },
})

/**
 * Get the results of the last consolidation
 */
export const getConsolidationResults = tool({
  description: "Get the results from the last memory consolidation operation.",
  args: {
    limit: tool.schema.number().optional().describe("Maximum number of results to return (default: 10)"),
  },
  async execute(args, context) {
    const paths = getAutoDreamPaths(context)
    
    if (!existsSync(paths.resultsDir)) {
      return JSON.stringify({ results: [], total: 0 }, null, 2)
    }
    
    const files = readdirSync(paths.resultsDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse()
    
    const limit = args.limit || 10
    const results: ConsolidationResult[] = []
    
    for (const file of files.slice(0, limit)) {
      try {
        results.push(JSON.parse(readFileSync(join(paths.resultsDir, file), "utf-8")))
      } catch {}
    }
    
    return JSON.stringify({
      results,
      total: files.length,
    }, null, 2)
  },
})

/**
 * Get current memory patterns
 */
export const getMemoryPatterns = tool({
  description: "Get the current memory patterns identified by consolidation.",
  args: {
    type: tool.schema.string().optional().describe("Filter by pattern type: file_access, task_pattern, concept, context_entry"),
    minFrequency: tool.schema.number().optional().describe("Minimum frequency threshold"),
    limit: tool.schema.number().optional().describe("Maximum patterns to return (default: 100)"),
  },
  async execute(args, context) {
    let patterns = loadPatterns(context)
    
    // Filter by type
    if (args.type) {
      patterns = patterns.filter(p => p.type === args.type)
    }
    
    // Filter by frequency
    if (args.minFrequency !== undefined) {
      patterns = patterns.filter(p => p.frequency >= args.minFrequency!)
    }
    
    // Sort by relevance descending
    patterns.sort((a, b) => b.relevance - a.relevance)
    
    const limit = args.limit || 100
    const limitedPatterns = patterns.slice(0, limit)
    
    return JSON.stringify({
      patterns: limitedPatterns,
      total: patterns.length,
      filtered: {
        type: args.type || null,
        minFrequency: args.minFrequency || null,
      },
    }, null, 2)
  },
})

/**
 * Configure consolidation settings
 */
export const configureConsolidation = tool({
  description: "Configure auto-dream consolidation settings such as idle timeout, frequency thresholds, and staleness parameters.",
  args: {
    idleTimeoutMinutes: tool.schema.number().optional().describe("Minutes of idle time before consolidation triggers (default: 5)"),
    stalenessThresholdDays: tool.schema.number().optional().describe("Days before a pattern is considered stale (default: 7)"),
    frequencyThreshold: tool.schema.number().optional().describe("Minimum frequency to strengthen a concept (default: 3)"),
    maxEntriesPerConsolidation: tool.schema.number().optional().describe("Maximum patterns to retain (default: 1000)"),
    enableAutoTrigger: tool.schema.boolean().optional().describe("Enable automatic consolidation on idle"),
  },
  async execute(args, context) {
    const config = loadConfig(context)
    
    // Update config
    if (args.idleTimeoutMinutes !== undefined) {
      config.idleTimeoutMinutes = args.idleTimeoutMinutes
    }
    if (args.stalenessThresholdDays !== undefined) {
      config.stalenessThresholdDays = args.stalenessThresholdDays
    }
    if (args.frequencyThreshold !== undefined) {
      config.frequencyThreshold = args.frequencyThreshold
    }
    if (args.maxEntriesPerConsolidation !== undefined) {
      config.maxEntriesPerConsolidation = args.maxEntriesPerConsolidation
    }
    if (args.enableAutoTrigger !== undefined) {
      config.enableAutoTrigger = args.enableAutoTrigger
    }
    
    saveConfig(context, config)
    
    return JSON.stringify({
      success: true,
      message: "Consolidation configuration updated",
      config,
    }, null, 2)
  },
})

/**
 * Trigger idle detection check manually
 */
export const checkIdleAndConsolidate = tool({
  description: "Manually check if the agent is idle and trigger consolidation if conditions are met. This is useful for testing or manual triggering.",
  args: {},
  async execute(_args, context) {
    if (!isAutoDreamEnabled(context)) {
      return JSON.stringify({
        success: false,
        message: "auto_dream_enabled feature flag is not enabled",
        wouldConsolidate: false,
      }, null, 2)
    }
    
    const config = loadConfig(context)
    const lastActivity = loadLastActivity(context)
    
    // Check idle conditions
    if (!lastActivity.timestamp) {
      return JSON.stringify({
        success: true,
        message: "No activity recorded yet",
        isIdle: config.enableAutoTrigger,
        wouldConsolidate: config.enableAutoTrigger,
        idleDurationMinutes: 0,
      }, null, 2)
    }
    
    const idleDurationMinutes = (Date.now() - new Date(lastActivity.timestamp).getTime()) / (1000 * 60)
    const isIdle = idleDurationMinutes >= config.idleTimeoutMinutes && lastActivity.pendingActivities === 0
    
    if (!isIdle) {
      return JSON.stringify({
        success: true,
        message: "Agent is not idle",
        isIdle: false,
        wouldConsolidate: false,
        idleDurationMinutes: Math.round(idleDurationMinutes * 100) / 100,
        pendingActivities: lastActivity.pendingActivities,
      }, null, 2)
    }
    
    // Trigger consolidation
    saveStatus(context, { state: "detecting", lastConsolidationId: null })
    
    // Load append log entries
    let logEntries: any[] = []
    try {
      const logPath = join(context.directory, ".opencode/logs/append.log")
      if (existsSync(logPath)) {
        const content = readFileSync(logPath, "utf-8")
        const lines = content.split("\n").filter(line => line.trim())
        for (const line of lines.slice(-1000)) {
          try {
            logEntries.push(JSON.parse(line))
          } catch {}
        }
      }
    } catch {}
    
    const startTime = Date.now()
    
    // Analyze patterns
    const filePatterns = analyzeFileAccessPatterns(logEntries)
    const taskPatterns = analyzeTaskPatterns(logEntries)
    
    // Load existing patterns
    const existingPatterns = loadPatterns(context)
    
    // Merge patterns
    const mergedPatterns = [...existingPatterns]
    for (const newPattern of [...filePatterns, ...taskPatterns]) {
      const existingIndex = mergedPatterns.findIndex(p => p.key === newPattern.key && p.type === newPattern.type)
      if (existingIndex >= 0) {
        mergedPatterns[existingIndex] = {
          ...mergedPatterns[existingIndex],
          frequency: mergedPatterns[existingIndex].frequency + newPattern.frequency,
          lastSeen: newPattern.lastSeen,
        }
      } else {
        mergedPatterns.push(newPattern)
      }
    }
    
    // Strengthen and prune
    const strengthenedPatterns = strengthenFrequentConcepts(mergedPatterns, config.frequencyThreshold)
    const activePatterns = pruneStaleEntries(strengthenedPatterns, config.stalenessThresholdDays)
    const limitedPatterns = activePatterns.slice(-config.maxEntriesPerConsolidation)
    
    savePatterns(context, limitedPatterns)
    
    const duration = Date.now() - startTime
    
    const result: ConsolidationResult = {
      id: `consolidation_${Date.now()}`,
      timestamp: new Date().toISOString(),
      duration,
      entriesProcessed: logEntries.length,
      patternsIdentified: filePatterns.length + taskPatterns.length,
      conceptsStrengthened: strengthenedPatterns.length - mergedPatterns.length,
      staleEntriesPruned: mergedPatterns.length - activePatterns.length,
      contextEntriesUpdated: limitedPatterns.length,
      summary: `Idle consolidation triggered after ${idleDurationMinutes.toFixed(1)} minutes of inactivity. Processed ${logEntries.length} log entries.`,
    }
    
    saveConsolidationResult(context, result)
    saveStatus(context, { state: "idle", lastConsolidationId: result.id })
    
    return JSON.stringify({
      success: true,
      message: "Consolidation triggered by idle detection",
      isIdle: true,
      wouldConsolidate: true,
      idleDurationMinutes: Math.round(idleDurationMinutes * 100) / 100,
      result,
    }, null, 2)
  },
})

/**
 * Reset auto-dream state
 */
export const resetAutoDream = tool({
  description: "Reset the auto-dream service state including patterns and last activity. Useful for testing or starting fresh.",
  args: {
    clearPatterns: tool.schema.boolean().optional().describe("Clear all patterns (default: false)"),
    clearConfig: tool.schema.boolean().optional().describe("Reset config to defaults (default: false)"),
  },
  async execute(args, context) {
    const paths = getAutoDreamPaths(context)
    
    // Reset status
    saveStatus(context, { state: "idle", lastConsolidationId: null })
    
    // Reset last activity
    saveLastActivity(context, { timestamp: null, pendingActivities: 0 })
    
    // Clear patterns if requested
    if (args.clearPatterns && existsSync(paths.patternsPath)) {
      writeFileSync(paths.patternsPath, JSON.stringify([]), "utf-8")
    }
    
    // Reset config if requested
    if (args.clearConfig) {
      saveConfig(context, { ...DEFAULT_CONFIG })
    }
    
    return JSON.stringify({
      success: true,
      message: "Auto-dream state reset",
      clearedPatterns: args.clearPatterns || false,
      clearedConfig: args.clearConfig || false,
    }, null, 2)
  },
})

