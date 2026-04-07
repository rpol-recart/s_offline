import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "fs"
import { join } from "path"

/**
 * Transcript Compaction System for OpenCode
 * Based on KAIROS autoCompactEnabled pattern - compresses conversation history
 * when context grows large to prevent context window overflow.
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export type CompactionMethod = "summary" | "keypoints" | "selective"

export interface CompactionConfig {
  threshold: number // Percentage of context window (default 95)
  interval: number // Auto-check interval in minutes (default 5)
  method: CompactionMethod // Compaction method (default 'summary')
  preserveLastN: number // Always preserve last N messages (default 10)
  preserveDecisions: boolean // Preserve messages marked as decisions
  preserveFileChanges: boolean // Preserve file modification messages
}

export interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface CompactionRecord {
  id: string
  timestamp: string
  sessionId: string
  method: CompactionMethod
  originalMessageCount: number
  compactedMessageCount: number
  compactionRatio: number
  summary?: string
  keyPoints?: string[]
  originalFilePath?: string
  summaryFilePath?: string
  markers: Array<{ type: "start" | "end"; messageId: string; index: number }>
}

export interface CompactionStatus {
  needsCompaction: boolean
  currentMessages: number
  estimatedTokens: number
  contextWindow: number
  usagePercent: number
  lastCompaction?: string
  nextScheduledCheck?: string
  autoEnabled: boolean
  config: CompactionConfig
}

export interface CompactionResult {
  success: boolean
  recordId?: string
  originalCount: number
  compactedCount: number
  ratio: number
  method: CompactionMethod
  message: string
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: CompactionConfig = {
  threshold: 95,
  interval: 5,
  method: "summary",
  preserveLastN: 10,
  preserveDecisions: true,
  preserveFileChanges: true,
}

const DEFAULT_CONTEXT_WINDOW = 128000 // tokens (rough estimate for most models)

const COMPACTION_DIR = ".opencode/compaction"
const HISTORY_FILE = "history.json"
const SUMMARIES_DIR = "summaries"
const ORIGINALS_DIR = "originals"

// ============================================================================
// Helper Functions
// ============================================================================

function getCompactionPaths(context: { directory: string }) {
  return {
    baseDir: join(context.directory, COMPACTION_DIR),
    historyPath: join(context.directory, COMPACTION_DIR, HISTORY_FILE),
    summariesDir: join(context.directory, COMPACTION_DIR, SUMMARIES_DIR),
    originalsDir: join(context.directory, COMPACTION_DIR, ORIGINALS_DIR),
  }
}

function ensureCompactionDirs(context: { directory: string }) {
  const { baseDir, summariesDir, originalsDir } = getCompactionPaths(context)
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true })
  }
  if (!existsSync(summariesDir)) {
    mkdirSync(summariesDir, { recursive: true })
  }
  if (!existsSync(originalsDir)) {
    mkdirSync(originalsDir, { recursive: true })
  }
}

function loadHistory(context: { directory: string }): CompactionRecord[] {
  const { historyPath } = getCompactionPaths(context)
  if (!existsSync(historyPath)) {
    return []
  }
  try {
    return JSON.parse(readFileSync(historyPath, "utf-8"))
  } catch {
    return []
  }
}

function saveHistory(context: { directory: string }, history: CompactionRecord[]): void {
  const { historyPath } = getCompactionPaths(context)
  ensureCompactionDirs(context)
  writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8")
}

function loadConfig(context: { directory: string }): CompactionConfig {
  const configPath = join(context.directory, COMPACTION_DIR, "config.json")
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG }
  }
  try {
    const saved = JSON.parse(readFileSync(configPath, "utf-8"))
    return { ...DEFAULT_CONFIG, ...saved }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(context: { directory: string }, config: CompactionConfig): void {
  const configPath = join(context.directory, COMPACTION_DIR, "config.json")
  ensureCompactionDirs(context)
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
}

function isAutoCompactEnabled(context: { directory: string }): boolean {
  try {
    const flagsPath = join(context.directory, ".opencode/feature-flags.json")
    if (!existsSync(flagsPath)) {
      return false
    }
    const flagsData = JSON.parse(readFileSync(flagsPath, "utf-8"))
    return flagsData.flags?.auto_compact_enabled?.enabled === true
  } catch {
    return false
  }
}

function estimateTokenCount(messages: Message[]): number {
  // Rough estimation: ~4 characters per token on average
  // This is a conservative estimate
  let totalChars = 0
  for (const msg of messages) {
    totalChars += msg.content.length + 10 // +10 for role formatting
  }
  return Math.ceil(totalChars / 4)
}

function generateId(): string {
  return `compact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function isFileChangeMessage(content: string): boolean {
  const patterns = [
    /file:\s*\//i,
    /created\s+file/i,
    /modified\s+file/i,
    /deleted\s+file/i,
    /edited\s+file/i,
    /\.(ts|js|py|md|json|yaml|yml|toml|cfg|conf)$/i,
    /wrote\s+\d+\s+lines/i,
    /^\s*(const|let|var|function|class|import|export|def|async)\s/im,
  ]
  return patterns.some(p => p.test(content))
}

function isDecisionMessage(content: string): boolean {
  const patterns = [
    /decided to/i,
    /chose to/i,
    /selected/i,
    /decision:/i,
    /will proceed with/i,
    /going with/i,
    /choosing/i,
  ]
  return patterns.some(p => p.test(content))
}

function markMessage(msg: Message, marker: string): Message {
  return {
    ...msg,
    content: `[COMPACTED:${marker}]\n${msg.content}`,
  }
}

// ============================================================================
// Compaction Methods
// ============================================================================

function summarizeMessages(messages: Message[], preserveLastN: number): { summary: string; compacted: Message[] } {
  // Keep the last N messages as-is
  const keep = messages.slice(-preserveLastN)
  const toSummarize = messages.slice(0, -preserveLastN)

  if (toSummarize.length === 0) {
    return { summary: "No messages to summarize", compacted: messages }
  }

  // Create summary by grouping consecutive messages
  let summary = `## Conversation Summary (${toSummarize.length} messages compacted)\n\n`

  // Group by role
  const byRole: Record<string, Message[]> = { user: [], assistant: [], system: [] }
  for (const msg of toSummarize) {
    if (byRole[msg.role]) {
      byRole[msg.role].push(msg)
    }
  }

  // Summarize each role's contribution
  for (const [role, msgs] of Object.entries(byRole)) {
    if (msgs.length > 0) {
      const totalLength = msgs.reduce((sum, m) => sum + m.content.length, 0)
      const avgLength = Math.round(totalLength / msgs.length)
      const preview = msgs.length <= 3
        ? msgs.map(m => m.content.substring(0, 100)).join("\n---\n")
        : `${msgs[0].content.substring(0, 80)}... (${msgs.length} ${role} messages, avg ${avgLength} chars)`

      summary += `### ${role.toUpperCase()} (${msgs.length} messages)\n${preview}\n\n`
    }
  }

  // Add key topics/themes if detectable
  const allText = toSummarize.map(m => m.content).join(" ")
  const words = allText.toLowerCase().split(/\s+/).filter(w => w.length > 4)
  const wordFreq: Record<string, number> = {}
  for (const word of words) {
    wordFreq[word] = (wordFreq[word] || 0) + 1
  }
  const topWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w)

  if (topWords.length > 0) {
    summary += `### Key Topics\n${topWords.join(", ")}\n`
  }

  // Create compacted representation
  const compacted: Message[] = [
    {
      id: generateId(),
      role: "system",
      content: `[COMPACTED REGION START - ${toSummarize.length} messages summarized]\n${summary}\n[COMPACTED REGION END]`,
      timestamp: toSummarize[0].timestamp,
      metadata: { compacted: true, originalCount: toSummarize.length, method: "summary" },
    },
    ...keep,
  ]

  return { summary, compacted }
}

function extractKeyPoints(messages: Message[], preserveLastN: number, preserveFileChanges: boolean, preserveDecisions: boolean): { keyPoints: string[]; compacted: Message[] } {
  const keep = messages.slice(-preserveLastN)
  const toProcess = messages.slice(0, -preserveLastN)

  if (toProcess.length === 0) {
    return { keyPoints: [], compacted: messages }
  }

  const keyPoints: string[] = []

  // Extract file changes as key points
  if (preserveFileChanges) {
    for (const msg of toProcess) {
      if (isFileChangeMessage(msg.content)) {
        const preview = msg.content.substring(0, 150)
        keyPoints.push(`[FILE] ${preview}${msg.content.length > 150 ? "..." : ""}`)
      }
    }
  }

  // Extract decisions
  if (preserveDecisions) {
    for (const msg of toProcess) {
      if (isDecisionMessage(msg.content)) {
        const preview = msg.content.substring(0, 200)
        keyPoints.push(`[DECISION] ${preview}${msg.content.length > 200 ? "..." : ""}`)
      }
    }
  }

  // Extract tool usage patterns
  const toolCalls = toProcess.filter(m => m.content.includes("```") || m.content.includes("TOOL:"))
  if (toolCalls.length > 0) {
    keyPoints.push(`[TOOLS] ${toolCalls.length} tool/code interactions`)
  }

  // Extract questions and responses
  const exchanges: string[] = []
  let currentQ = ""
  for (const msg of toProcess) {
    if (msg.role === "user") {
      currentQ = msg.content.substring(0, 100)
    } else if (msg.role === "assistant" && currentQ) {
      const response = msg.content.substring(0, 80)
      exchanges.push(`Q: ${currentQ}... A: ${response}...`)
      currentQ = ""
    }
  }
  if (exchanges.length > 0) {
    keyPoints.push(`[EXCHANGES] ${exchanges.length} Q&A interactions`)
  }

  // Create compacted representation
  const compacted: Message[] = [
    {
      id: generateId(),
      role: "system",
      content: `[COMPACTED REGION START - ${toProcess.length} messages → ${keyPoints.length} key points]\n${keyPoints.map(p => `- ${p}`).join("\n")}\n[COMPACTED REGION END]`,
      timestamp: toProcess[0].timestamp,
      metadata: { compacted: true, originalCount: toProcess.length, keyPoints: keyPoints.length, method: "keypoints" },
    },
    ...keep,
  ]

  return { keyPoints, compacted }
}

function preserveImportantMessages(messages: Message[], preserveLastN: number, preserveDecisions: boolean, preserveFileChanges: boolean): Message[] {
  if (messages.length <= preserveLastN) {
    return messages
  }

  const keep = messages.slice(-preserveLastN)
  const toProcess = messages.slice(0, -preserveLastN)

  const important: Message[] = []

  // Always preserve decisions
  if (preserveDecisions) {
    for (const msg of toProcess) {
      if (isDecisionMessage(msg.content)) {
        important.push(msg)
      }
    }
  }

  // Always preserve file changes
  if (preserveFileChanges) {
    for (const msg of toProcess) {
      if (isFileChangeMessage(msg.content)) {
        important.push(msg)
      }
    }
  }

  // Remove duplicates while preserving order
  const seen = new Set<string>()
  const uniqueImportant = important.filter(msg => {
    const key = msg.content.substring(0, 50)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Mark the compacted region
  if (toProcess.length > uniqueImportant.length) {
    const compactedRegion: Message = {
      id: generateId(),
      role: "system",
      content: `[COMPACTED REGION START - ${toProcess.length - uniqueImportant.length} routine messages removed, ${uniqueImportant.length} important preserved]`,
      timestamp: toProcess[0].timestamp,
      metadata: { compacted: true, originalCount: toProcess.length, preservedCount: uniqueImportant.length, method: "selective" },
    }
    return [compactedRegion, ...uniqueImportant, ...keep]
  }

  return [...uniqueImportant, ...keep]
}

// ============================================================================
// Tools
// ============================================================================

/**
 * Get current compaction status and whether compaction is needed
 */
export const getCompactionStatus = tool({
  description: "Get the current compaction status including token usage and whether compaction is needed",
  args: {
    session_id: tool.schema.string().optional().describe("Session ID to check (uses current session if not provided)"),
    context_window: tool.schema.number().optional().describe("Context window size in tokens (default: 128000)").default(DEFAULT_CONTEXT_WINDOW),
  },
  async execute(args, context) {
    const config = loadConfig(context)
    const autoEnabled = isAutoCompactEnabled(context)
    const history = loadHistory(context)

    // Try to get messages from session store
    let messages: Message[] = []
    let sessionId = args.session_id

    if (!sessionId) {
      // Try to get current session
      try {
        const indexPath = join(context.directory, ".opencode/sessions/index.json")
        if (existsSync(indexPath)) {
          const index = JSON.parse(readFileSync(indexPath, "utf-8"))
          sessionId = index.currentSessionId
        }
      } catch {}
    }

    if (sessionId) {
      try {
        const sessionPath = join(context.directory, `.opencode/sessions/${sessionId}.json`)
        if (existsSync(sessionPath)) {
          const session = JSON.parse(readFileSync(sessionPath, "utf-8"))
          messages = session.context?.messages || []
        }
      } catch {}
    }

    const estimatedTokens = estimateTokenCount(messages)
    const contextWindow = args.context_window
    const usagePercent = Math.round((estimatedTokens / contextWindow) * 100)
    const needsCompaction = usagePercent >= config.threshold

    const lastCompaction = history.length > 0 ? history[history.length - 1].timestamp : undefined

    let nextScheduledCheck: string | undefined
    if (autoEnabled && config.interval > 0) {
      const lastCheck = lastCompaction ? new Date(lastCompaction) : new Date()
      nextScheduledCheck = new Date(lastCheck.getTime() + config.interval * 60 * 1000).toISOString()
    }

    return JSON.stringify({
      needs_compaction: needsCompaction,
      current_messages: messages.length,
      estimated_tokens: estimatedTokens,
      context_window: contextWindow,
      usage_percent: usagePercent,
      threshold_percent: config.threshold,
      last_compaction: lastCompaction,
      next_scheduled_check: nextScheduledCheck,
      auto_enabled: autoEnabled,
      config: config,
    }, null, 2)
  },
})

/**
 * Manually trigger compaction on the current session
 */
export const compactNow = tool({
  description: "Manually trigger transcript compaction on the current session",
  args: {
    session_id: tool.schema.string().optional().describe("Session ID to compact (uses current session if not provided)"),
    method: tool.schema.enum(["summary", "keypoints", "selective"]).optional().describe("Compaction method to use").default("summary"),
    preserve_last_n: tool.schema.number().optional().describe("Number of recent messages to always preserve").default(10),
  },
  async execute(args, context) {
    ensureCompactionDirs(context)
    const config = loadConfig(context)
    const method = args.method || config.method
    const preserveLastN = args.preserve_last_n || config.preserveLastN

    let messages: Message[] = []
    let sessionId = args.session_id

    if (!sessionId) {
      try {
        const indexPath = join(context.directory, ".opencode/sessions/index.json")
        if (existsSync(indexPath)) {
          const index = JSON.parse(readFileSync(indexPath, "utf-8"))
          sessionId = index.currentSessionId
        }
      } catch {}
    }

    if (!sessionId) {
      return JSON.stringify({
        success: false,
        message: "No session ID provided and no current session found",
      }, null, 2)
    }

    try {
      const sessionPath = join(context.directory, `.opencode/sessions/${sessionId}.json`)
      if (existsSync(sessionPath)) {
        const session = JSON.parse(readFileSync(sessionPath, "utf-8"))
        messages = session.context?.messages || []
      }
    } catch {
      return JSON.stringify({
        success: false,
        message: "Failed to load session",
      }, null, 2)
    }

    const originalCount = messages.length

    if (messages.length <= preserveLastN) {
      return JSON.stringify({
        success: false,
        message: "Not enough messages to compact",
        original_count: originalCount,
        compacted_count: messages.length,
      }, null, 2)
    }

    // Archive original messages
    const { originalsDir, summariesDir } = getCompactionPaths(context)
    const archiveId = generateId()
    const originalFilePath = join(originalsDir, `${archiveId}.json`)
    writeFileSync(originalFilePath, JSON.stringify(messages, null, 2), "utf-8")

    // Apply compaction method
    let summary: string | undefined
    let keyPoints: string[] | undefined
    let compacted: Message[]

    switch (method) {
      case "summary":
        const sumResult = summarizeMessages(messages, preserveLastN)
        summary = sumResult.summary
        compacted = sumResult.compacted
        break
      case "keypoints":
        const kpResult = extractKeyPoints(messages, preserveLastN, config.preserveFileChanges, config.preserveDecisions)
        keyPoints = kpResult.keyPoints
        compacted = kpResult.compacted
        break
      case "selective":
      default:
        compacted = preserveImportantMessages(messages, preserveLastN, config.preserveDecisions, config.preserveFileChanges)
        break
    }

    // Save summary if generated
    let summaryFilePath: string | undefined
    if (summary || keyPoints) {
      summaryFilePath = join(summariesDir, `${archiveId}.json`)
      writeFileSync(summaryFilePath, JSON.stringify({ summary, keyPoints, method, timestamp: new Date().toISOString() }, null, 2), "utf-8")
    }

    // Create compaction record
    const record: CompactionRecord = {
      id: archiveId,
      timestamp: new Date().toISOString(),
      sessionId: sessionId,
      method: method,
      originalMessageCount: originalCount,
      compactedMessageCount: compacted.length,
      compactionRatio: Math.round((1 - compacted.length / originalCount) * 100),
      summary,
      keyPoints,
      originalFilePath,
      summaryFilePath,
      markers: [
        { type: "start", messageId: compacted[0]?.id || "", index: 0 },
        { type: "end", messageId: compacted[compacted.length - 1]?.id || "", index: compacted.length - 1 },
      ],
    }

    // Update history
    const history = loadHistory(context)
    history.push(record)
    saveHistory(context, history)

    // Update session with compacted messages
    try {
      const sessionPath = join(context.directory, `.opencode/sessions/${sessionId}.json`)
      const session = JSON.parse(readFileSync(sessionPath, "utf-8"))
      session.context.messages = compacted
      session.updatedAt = new Date().toISOString()
      writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
    } catch {
      return JSON.stringify({
        success: false,
        message: "Compaction completed but failed to update session",
        record_id: archiveId,
        original_count: originalCount,
        compacted_count: compacted.length,
        ratio: record.compactionRatio,
        method: method,
      }, null, 2)
    }

    // Log the compaction event
    try {
      const logPath = join(context.directory, ".opencode/logs/append.log")
      if (existsSync(logPath)) {
        const logEntry = JSON.stringify({
          id: generateId(),
          timestamp: new Date().toISOString(),
          type: "memory",
          message: `Transcript compaction performed: ${originalCount} → ${compacted.length} messages (${record.compactionRatio}% reduction)`,
          metadata: { recordId: archiveId, sessionId, method },
        }) + "\n"
        appendFileSync(logPath, logEntry, "utf-8")
      }
    } catch {}

    return JSON.stringify({
      success: true,
      record_id: archiveId,
      original_count: originalCount,
      compacted_count: compacted.length,
      ratio: record.compactionRatio,
      method: method,
      original_file: originalFilePath,
      summary_file: summaryFilePath,
      message: `Compaction successful: ${originalCount} messages → ${compacted.length} messages (${record.compactionRatio}% reduction)`,
    }, null, 2)
  },
})

/**
 * Configure compaction settings
 */
export const configureCompaction = tool({
  description: "Configure transcript compaction settings",
  args: {
    threshold: tool.schema.number().optional().describe("Context threshold percentage to trigger auto-compaction (default: 95)"),
    interval: tool.schema.number().optional().describe("Auto-check interval in minutes (default: 5, 0 to disable)"),
    method: tool.schema.enum(["summary", "keypoints", "selective"]).optional().describe("Default compaction method"),
    preserve_last_n: tool.schema.number().optional().describe("Number of recent messages to always preserve"),
    preserve_decisions: tool.schema.boolean().optional().describe("Preserve decision messages during compaction"),
    preserve_file_changes: tool.schema.boolean().optional().describe("Preserve file change messages during compaction"),
  },
  async execute(args, context) {
    const config = loadConfig(context)

    // Update provided fields
    if (args.threshold !== undefined) config.threshold = args.threshold
    if (args.interval !== undefined) config.interval = args.interval
    if (args.method !== undefined) config.method = args.method
    if (args.preserve_last_n !== undefined) config.preserveLastN = args.preserve_last_n
    if (args.preserve_decisions !== undefined) config.preserveDecisions = args.preserve_decisions
    if (args.preserve_file_changes !== undefined) config.preserveFileChanges = args.preserve_file_changes

    saveConfig(context, config)

    return JSON.stringify({
      success: true,
      config: config,
      message: "Compaction configuration updated",
    }, null, 2)
  },
})

/**
 * Get compaction history
 */
export const getCompactionHistory = tool({
  description: "Get the history of all compaction operations",
  args: {
    session_id: tool.schema.string().optional().describe("Filter by session ID"),
    limit: tool.schema.number().optional().describe("Maximum number of records to return").default(50),
  },
  async execute(args, context) {
    let history = loadHistory(context)

    if (args.session_id) {
      history = history.filter(r => r.sessionId === args.session_id)
    }

    const limited = history.slice(-(args.limit || 50))

    return JSON.stringify({
      records: limited,
      total: history.length,
      filtered: args.session_id || null,
    }, null, 2)
  },
})

/**
 * Restore original messages from a compaction record
 */
export const restoreCompaction = tool({
  description: "Restore original messages from a compaction record (rollback)",
  args: {
    record_id: tool.schema.string().describe("The compaction record ID to restore from"),
    session_id: tool.schema.string().optional().describe("Session ID to restore to (must match original session)"),
  },
  async execute(args, context) {
    const history = loadHistory(context)
    const record = history.find(r => r.id === args.record_id)

    if (!record) {
      return JSON.stringify({
        success: false,
        message: `Compaction record not found: ${args.record_id}`,
      }, null, 2)
    }

    if (!record.originalFilePath || !existsSync(record.originalFilePath)) {
      return JSON.stringify({
        success: false,
        message: "Original messages file not found - cannot restore",
      }, null, 2)
    }

    // Load original messages
    const originalMessages: Message[] = JSON.parse(readFileSync(record.originalFilePath, "utf-8"))

    // Validate session
    const sessionId = args.session_id || record.sessionId
    if (sessionId !== record.sessionId) {
      return JSON.stringify({
        success: false,
        message: `Session mismatch: record is for ${record.sessionId}, cannot restore to ${sessionId}`,
      }, null, 2)
    }

    // Restore to session
    try {
      const sessionPath = join(context.directory, `.opencode/sessions/${sessionId}.json`)
      const session = JSON.parse(readFileSync(sessionPath, "utf-8"))
      session.context.messages = originalMessages
      session.updatedAt = new Date().toISOString()
      writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
    } catch {
      return JSON.stringify({
        success: false,
        message: "Failed to restore session",
      }, null, 2)
    }

    // Log restoration
    try {
      const logPath = join(context.directory, ".opencode/logs/append.log")
      if (existsSync(logPath)) {
        const logEntry = JSON.stringify({
          id: generateId(),
          timestamp: new Date().toISOString(),
          type: "memory",
          message: `Compaction rollback: restored ${originalMessages.length} original messages`,
          metadata: { recordId: record.id, sessionId },
        }) + "\n"
        appendFileSync(logPath, logEntry, "utf-8")
      }
    } catch {}

    return JSON.stringify({
      success: true,
      message: `Restored ${originalMessages.length} original messages`,
      original_count: originalMessages.length,
      session_id: sessionId,
    }, null, 2)
  },
})

/**
 * Get summary from a compaction record
 */
export const getCompactionSummary = tool({
  description: "Get the summary/keypoints from a compaction record",
  args: {
    record_id: tool.schema.string().describe("The compaction record ID to get summary from"),
  },
  async execute(args, context) {
    const history = loadHistory(context)
    const record = history.find(r => r.id === args.record_id)

    if (!record) {
      return JSON.stringify({
        success: false,
        message: `Compaction record not found: ${args.record_id}`,
      }, null, 2)
    }

    // Try to load from summary file
    if (record.summaryFilePath && existsSync(record.summaryFilePath)) {
      try {
        const summaryData = JSON.parse(readFileSync(record.summaryFilePath, "utf-8"))
        return JSON.stringify({
          success: true,
          record_id: record.id,
          method: record.method,
          summary: summaryData.summary,
          key_points: summaryData.keyPoints,
          timestamp: record.timestamp,
        }, null, 2)
      } catch {}
    }

    // Fall back to inline data
    return JSON.stringify({
      success: true,
      record_id: record.id,
      method: record.method,
      summary: record.summary,
      key_points: record.keyPoints,
      timestamp: record.timestamp,
    }, null, 2)
  },
})

/**
 * List compaction archives
 */
export const listCompactionArchives = tool({
  description: "List all compaction archive files",
  args: {
    type: tool.schema.enum(["all", "originals", "summaries"]).optional().describe("Type of archives to list").default("all"),
  },
  async execute(args, context) {
    const { originalsDir, summariesDir } = getCompactionPaths(context)
    const archives: Array<{ id: string; type: "original" | "summary"; path: string; timestamp?: string }> = []

    if (args.type === "all" || args.type === "originals") {
      if (existsSync(originalsDir)) {
        for (const file of readdirSync(originalsDir)) {
          if (file.endsWith(".json")) {
            const id = file.replace(".json", "")
            archives.push({
              id,
              type: "original",
              path: join(originalsDir, file),
            })
          }
        }
      }
    }

    if (args.type === "all" || args.type === "summaries") {
      if (existsSync(summariesDir)) {
        for (const file of readdirSync(summariesDir)) {
          if (file.endsWith(".json")) {
            const id = file.replace(".json", "")
            archives.push({
              id,
              type: "summary",
              path: join(summariesDir, file),
            })
          }
        }
      }
    }

    return JSON.stringify({
      archives,
      total: archives.length,
    }, null, 2)
  },
})

