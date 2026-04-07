import { tool } from "@opencode-ai/plugin"
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"

/**
 * Append-Only Log System for OpenCode agents.
 * Based on KAIROS patterns - logs are used for transparency, debugging, audit trail, and memory consolidation.
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export type LogType = "info" | "warn" | "error" | "task" | "daemon" | "memory" | "session"

export interface LogEntry {
  id: string
  timestamp: string
  type: LogType
  message: string
  metadata?: Record<string, unknown>
  agentId?: string
  sessionId?: string
}

export interface LogStats {
  totalEntries: number
  byType: Record<LogType, number>
  oldestEntry?: string
  newestEntry?: string
  fileSize: number
  filePath: string
  indexPath: string
  rotatedFiles: string[]
}

export interface LogFilter {
  type?: LogType
  agentId?: string
  sessionId?: string
  since?: string
  until?: string
}

// ============================================================================
// Constants
// ============================================================================

const LOG_DIR = ".opencode/logs"
const LOG_FILE = "append.log"
const INDEX_FILE = "log.index"
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

// ============================================================================
// Helper Functions
// ============================================================================

function getLogPaths(context: { directory: string }) {
  return {
    logDir: join(context.directory, LOG_DIR),
    logPath: join(context.directory, LOG_DIR, LOG_FILE),
    indexPath: join(context.directory, LOG_DIR, INDEX_FILE),
  }
}

function ensureLogDir(context: { directory: string }) {
  const { logDir } = getLogPaths(context)
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}

function shouldRotate(filePath: string): boolean {
  return getFileSize(filePath) >= MAX_FILE_SIZE
}

function rotateLog(logPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const rotatedPath = `${logPath}.${timestamp}`
  // Note: We don't actually move/rename - we just note rotation
  // The log continues to append to the same file
  // Rotation is a conceptual checkpoint, not actual file rotation
  return rotatedPath
}

function buildIndex(indexPath: string, logEntries: LogEntry[]) {
  const index: Record<string, number> = {}
  logEntries.forEach((entry, idx) => {
    index[entry.id] = idx
  })
  writeFileSync(indexPath, JSON.stringify(index), "utf-8")
  return index
}

function parseLogLine(line: string): LogEntry | null {
  try {
    return JSON.parse(line) as LogEntry
  } catch {
    return null
  }
}

// ============================================================================
// Tool Implementations
// ============================================================================

const VALID_LOG_TYPES: LogType[] = ["info", "warn", "error", "task", "daemon", "memory", "session"]

export const append = tool({
  description: "Append a new entry to the append-only log. Use this to record events, tasks, daemon activity, and memory operations.",
  args: {
    type: tool.schema.string().describe("Log entry type: info, warn, error, task, daemon, memory, or session"),
    message: tool.schema.string().describe("Log message content"),
    metadata: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional()
      .describe("Optional metadata object with additional context"),
    agentId: tool.schema.string().optional().describe("Agent ID if applicable"),
    sessionId: tool.schema.string().optional().describe("Session ID if applicable"),
  },
  async execute(args, context) {
    ensureLogDir(context)
    const { logPath, indexPath } = getLogPaths(context)

    // Validate log type
    if (!VALID_LOG_TYPES.includes(args.type as LogType)) {
      return JSON.stringify({
        success: false,
        error: `Invalid log type: ${args.type}. Valid types: ${VALID_LOG_TYPES.join(", ")}`,
      })
    }

    const entry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: args.type as LogType,
      message: args.message,
      metadata: args.metadata,
      agentId: args.agentId,
      sessionId: args.sessionId,
    }

    const line = JSON.stringify(entry) + "\n"
    appendFileSync(logPath, line, "utf-8")

    // Check if rotation is needed (for tracking purposes)
    if (shouldRotate(logPath)) {
      const rotatedPath = rotateLog(logPath)
      return JSON.stringify({
        success: true,
        entry,
        rotated: true,
        rotatedPath,
        message: `Log entry appended. File approaching size limit, rotation checkpoint: ${rotatedPath}`,
      })
    }

    return JSON.stringify({
      success: true,
      entry,
      rotated: false,
    })
  },
})

export const read_ = tool({
  description: "Read log entries with optional filtering. Returns entries in reverse chronological order (newest first).",
  args: {
    filter: tool.schema.object({
      type: tool.schema.string().optional()
        .describe("Filter by log type: info, warn, error, task, daemon, memory, or session"),
      agentId: tool.schema.string().optional().describe("Filter by agent ID"),
      sessionId: tool.schema.string().optional().describe("Filter by session ID"),
      since: tool.schema.string().optional().describe("ISO 8601 timestamp - only entries after this time"),
      until: tool.schema.string().optional().describe("ISO 8601 timestamp - only entries before this time"),
    }).optional().describe("Filter criteria"),
    limit: tool.schema.number().optional().describe("Maximum number of entries to return (default: all)"),
  },
  async execute(args, context) {
    const { logPath } = getLogPaths(context)

    if (!existsSync(logPath)) {
      return JSON.stringify({ entries: [], total: 0, message: "No log entries found" })
    }

    const content = readFileSync(logPath, "utf-8")
    const lines = content.split("\n").filter(line => line.trim())

    let entries: LogEntry[] = []
    for (const line of lines) {
      const entry = parseLogLine(line)
      if (entry) {
        entries.push(entry)
      }
    }

    // Apply filters
    if (args.filter) {
      const { type, agentId, sessionId, since, until } = args.filter
      entries = entries.filter(entry => {
        if (type && entry.type !== type) return false
        if (agentId && entry.agentId !== agentId) return false
        if (sessionId && entry.sessionId !== sessionId) return false
        if (since && entry.timestamp < since) return false
        if (until && entry.timestamp > until) return false
        return true
      })
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    // Apply limit
    const limitedEntries = args.limit ? entries.slice(0, args.limit) : entries

    return JSON.stringify({
      entries: limitedEntries,
      total: entries.length,
      returned: limitedEntries.length,
      filter: args.filter || null,
    }, null, 2)
  },
})

export const search = tool({
  description: "Search log entries by query string. Searches message content and metadata values.",
  args: {
    query: tool.schema.string().describe("Search query string"),
    limit: tool.schema.number().optional().describe("Maximum number of entries to return (default: 50)"),
  },
  async execute(args, context) {
    const { logPath } = getLogPaths(context)

    if (!existsSync(logPath)) {
      return JSON.stringify({ entries: [], total: 0, message: "No log entries found" })
    }

    const content = readFileSync(logPath, "utf-8")
    const lines = content.split("\n").filter(line => line.trim())

    const query = args.query.toLowerCase()
    const results: LogEntry[] = []

    for (const line of lines) {
      const entry = parseLogLine(line)
      if (!entry) continue

      // Search in message
      if (entry.message.toLowerCase().includes(query)) {
        results.push(entry)
        continue
      }

      // Search in metadata
      if (entry.metadata) {
        const metadataStr = JSON.stringify(entry.metadata).toLowerCase()
        if (metadataStr.includes(query)) {
          results.push(entry)
          continue
        }
      }

      // Search in type
      if (entry.type.toLowerCase().includes(query)) {
        results.push(entry)
      }
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    const limitedResults = args.limit ? results.slice(0, args.limit) : results.slice(0, 50)

    return JSON.stringify({
      entries: limitedResults,
      total: results.length,
      query: args.query,
    }, null, 2)
  },
})

export const getStats = tool({
  description: "Get statistics about the append-only log including entry counts by type, file size, and rotated files.",
  args: {},
  async execute(_args, context) {
    ensureLogDir(context)
    const { logPath, indexPath, logDir } = getLogPaths(context)

    const stats: LogStats = {
      totalEntries: 0,
      byType: {
        info: 0,
        warn: 0,
        error: 0,
        task: 0,
        daemon: 0,
        memory: 0,
        session: 0,
      },
      fileSize: 0,
      filePath: logPath,
      indexPath,
      rotatedFiles: [],
    }

    if (!existsSync(logPath)) {
      return JSON.stringify(stats)
    }

    // Get rotated files
    try {
      const files = readdirSync(logDir)
      stats.rotatedFiles = files
        .filter(f => f.startsWith("append.log."))
        .map(f => join(logDir, f))
    } catch {}

    const content = readFileSync(logPath, "utf-8")
    const lines = content.split("\n").filter(line => line.trim())

    let oldest: string | undefined
    let newest: string | undefined

    for (const line of lines) {
      const entry = parseLogLine(line)
      if (!entry) continue

      stats.totalEntries++
      stats.byType[entry.type]++
      stats.fileSize += Buffer.byteLength(line, "utf-8") + 1

      if (!oldest || entry.timestamp < oldest) {
        oldest = entry.timestamp
      }
      if (!newest || entry.timestamp > newest) {
        newest = entry.timestamp
      }
    }

    stats.oldestEntry = oldest
    stats.newestEntry = newest

    return JSON.stringify(stats, null, 2)
  },
})

// ============================================================================
// Default Export (all tools)
// ============================================================================

// Named exports above are the tool definitions.
// Do NOT use export default with a plain object — it's not a valid ToolDefinition.
