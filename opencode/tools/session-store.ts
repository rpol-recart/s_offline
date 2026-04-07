import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "fs"
import { join } from "path"

// ============================================================================
// Types
// ============================================================================

export interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: string
}

export interface Task {
  id: string
  description: string
  status: "pending" | "in_progress" | "done" | "failed"
  result?: string
  createdAt: string
  completedAt?: string
}

export interface SessionContext {
  messages: Message[]
  files: string[]
  tools: string[]
  taskHistory: Task[]
  variables: Record<string, unknown>
  lastActiveAgent?: string
  workingDirectory?: string
}

export interface Session {
  id: string
  name?: string
  createdAt: string
  updatedAt: string
  status: "active" | "paused" | "terminated"
  metadata: Record<string, unknown>
  context: SessionContext
}

export interface SessionSummary {
  id: string
  name?: string
  status: "active" | "paused" | "terminated"
  createdAt: string
  updatedAt: string
  metadata: Record<string, unknown>
  messageCount?: number
  taskCount?: number
}

interface SessionIndex {
  sessions: string[]
  currentSessionId: string | null
  lastModified: string
}

// ============================================================================
// Constants
// ============================================================================

const SESSIONS_DIR = ".opencode/sessions"
const SESSION_INDEX_FILE = ".opencode/sessions/index.json"
const LOCK_FILE = ".opencode/sessions/.lock"

// ============================================================================
// Utility Functions
// ============================================================================

function getSessionsDir(context: { directory: string }): string {
  return join(context.directory, SESSIONS_DIR)
}

function getSessionPath(context: { directory: string }, sessionId: string): string {
  return join(getSessionsDir(context), `${sessionId}.json`)
}

function getIndexPath(context: { directory: string }): string {
  return join(context.directory, SESSION_INDEX_FILE)
}

function getLockPath(context: { directory: string }): string {
  return join(context.directory, LOCK_FILE)
}

function ensureSessionsDir(context: { directory: string }): void {
  const dir = getSessionsDir(context)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function generateId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function createEmptyContext(): SessionContext {
  return {
    messages: [],
    files: [],
    tools: [],
    taskHistory: [],
    variables: {},
  }
}

function loadIndex(context: { directory: string }): SessionIndex {
  const indexPath = getIndexPath(context)
  if (!existsSync(indexPath)) {
    return {
      sessions: [],
      currentSessionId: null,
      lastModified: new Date().toISOString(),
    }
  }
  try {
    return JSON.parse(readFileSync(indexPath, "utf-8"))
  } catch {
    return {
      sessions: [],
      currentSessionId: null,
      lastModified: new Date().toISOString(),
    }
  }
}

function saveIndex(context: { directory: string }, index: SessionIndex): void {
  const indexPath = getIndexPath(context)
  ensureSessionsDir(context)
  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8")
}

// Lock file utilities for concurrent access
function acquireLock(context: { directory: string }): boolean {
  const lockPath = getLockPath(context)
  if (existsSync(lockPath)) {
    // Check if lock is stale (older than 30 seconds)
    try {
      const lockData = JSON.parse(readFileSync(lockPath, "utf-8"))
      const lockAge = Date.now() - new Date(lockData.timestamp).getTime()
      if (lockAge > 30000) {
        // Stale lock, remove it
        unlinkSync(lockPath)
      } else {
        return false
      }
    } catch {
      // No valid lock file, proceed
      unlinkSync(lockPath)
    }
  }
  writeFileSync(lockPath, JSON.stringify({ timestamp: new Date().toISOString() }), "utf-8")
  return true
}

function releaseLock(context: { directory: string }): void {
  const lockPath = getLockPath(context)
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath)
    } catch {
      // Ignore errors on lock removal
    }
  }
}

// Debounce utility for auto-save
const debounceTimers: Map<string, NodeJS.Timeout> = new Map()

function debounce(key: string, fn: () => void, delayMs: number = 5000): void {
  const existing = debounceTimers.get(key)
  if (existing) {
    clearTimeout(existing)
  }
  const timer = setTimeout(() => {
    fn()
    debounceTimers.delete(key)
  }, delayMs)
  debounceTimers.set(key, timer)
}

// ============================================================================
// Session Store Tools
// ============================================================================

/**
 * Create a new session
 */
export const createSession = tool({
  description: "Create a new session for persistent agent context",
  args: {
    name: tool.schema.string().optional().describe("Optional name for the session"),
    metadata: tool.schema.record(tool.schema.string(), tool.schema.any()).optional().describe("Custom metadata for the session"),
  },
  async execute(args, context) {
    ensureSessionsDir(context)
    
    const sessionId = generateId()
    const now = new Date().toISOString()
    
    const session: Session = {
      id: sessionId,
      name: args.name,
      createdAt: now,
      updatedAt: now,
      status: "active",
      metadata: args.metadata || {},
      context: createEmptyContext(),
    }
    
    // Save session file
    const sessionPath = getSessionPath(context, sessionId)
    writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
    
    // Update index
    const index = loadIndex(context)
    index.sessions.push(sessionId)
    index.currentSessionId = sessionId
    index.lastModified = now
    saveIndex(context, index)
    
    return JSON.stringify({
      session_id: sessionId,
      name: session.name,
      status: session.status,
      created_at: session.createdAt,
      message: `Session created successfully. Use this ID to restore: ${sessionId}`,
    }, null, 2)
  },
})

/**
 * Get a session by ID
 */
export const getSession = tool({
  description: "Get session details by session ID",
  args: {
    session_id: tool.schema.string().describe("The session ID to retrieve"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    try {
      const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
      return JSON.stringify(session, null, 2)
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to load session: ${e.message}` }, null, 2)
    }
  },
})

/**
 * List all sessions
 */
export const listSessions = tool({
  description: "List all sessions with their metadata",
  args: {},
  async execute(_args, context) {
    ensureSessionsDir(context)
    const index = loadIndex(context)
    
    const sessions: SessionSummary[] = []
    for (const sessionId of index.sessions) {
      const sessionPath = getSessionPath(context, sessionId)
      if (existsSync(sessionPath)) {
        try {
          const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
          sessions.push({
            id: session.id,
            name: session.name,
            status: session.status,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            metadata: session.metadata,
            messageCount: session.context.messages.length,
            taskCount: session.context.taskHistory.length,
          })
        } catch {
          // Skip corrupted sessions
        }
      }
    }
    
    return JSON.stringify({
      sessions,
      current_session_id: index.currentSessionId,
      total: sessions.length,
    }, null, 2)
  },
})

/**
 * Delete a session
 */
export const deleteSession = tool({
  description: "Delete a session by ID",
  args: {
    session_id: tool.schema.string().describe("The session ID to delete"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    // Remove session file
    unlinkSync(sessionPath)
    
    // Update index
    const index = loadIndex(context)
    index.sessions = index.sessions.filter(id => id !== args.session_id)
    if (index.currentSessionId === args.session_id) {
      index.currentSessionId = index.sessions[0] || null
    }
    index.lastModified = new Date().toISOString()
    saveIndex(context, index)
    
    return JSON.stringify({
      deleted: args.session_id,
      message: "Session deleted successfully",
      current_session_id: index.currentSessionId,
    }, null, 2)
  },
})

/**
 * Get the current active session
 */
export const getCurrentSession = tool({
  description: "Get the currently active session",
  args: {},
  async execute(_args, context) {
    const index = loadIndex(context)
    
    if (!index.currentSessionId) {
      return JSON.stringify({ error: "No active session. Create one with create_session." }, null, 2)
    }

    const sessionPath = getSessionPath(context, index.currentSessionId)
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: "Current session file not found. It may have been deleted." }, null, 2)
    }

    try {
      const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
      return JSON.stringify(session, null, 2)
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to load session: ${e.message}` }, null, 2)
    }
  },
})

/**
 * Set the current active session
 */
export const setCurrentSession = tool({
  description: "Set a session as the current active session",
  args: {
    session_id: tool.schema.string().describe("The session ID to set as current"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    const index = loadIndex(context)
    index.currentSessionId = args.session_id
    index.lastModified = new Date().toISOString()
    saveIndex(context, index)

    return JSON.stringify({
      current_session_id: args.session_id,
      message: "Current session updated",
    }, null, 2)
  },
})

/**
 * Update session context (auto-saved with debounce)
 */
export const updateSessionContext = tool({
  description: "Update the context of a session (auto-saved with debounce)",
  args: {
    session_id: tool.schema.string().describe("The session ID to update"),
    messages: tool.schema.array(tool.schema.object({
      id: tool.schema.string(),
      role: tool.schema.string(),
      content: tool.schema.string(),
      timestamp: tool.schema.string(),
    })).optional().describe("Updated messages array"),
    files: tool.schema.array(tool.schema.string()).optional().describe("Updated files array"),
    tools: tool.schema.array(tool.schema.string()).optional().describe("Updated tools array"),
    task_history: tool.schema.array(tool.schema.object({
      id: tool.schema.string(),
      description: tool.schema.string(),
      status: tool.schema.string(),
      result: tool.schema.string().optional(),
      createdAt: tool.schema.string(),
      completedAt: tool.schema.string().optional(),
    })).optional().describe("Updated task history"),
    variables: tool.schema.record(tool.schema.string(), tool.schema.any()).optional().describe("Updated variables"),
    last_active_agent: tool.schema.string().optional().describe("Last active agent name"),
    working_directory: tool.schema.string().optional().describe("Working directory"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    // Use debounced save to prevent excessive writes
    debounce(`session_${args.session_id}`, () => {
      try {
        const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
        
        // Merge updates
        if (args.messages) session.context.messages = args.messages as any
        if (args.files) session.context.files = args.files
        if (args.tools) session.context.tools = args.tools
        if (args.task_history) session.context.taskHistory = args.task_history as any
        if (args.variables) session.context.variables = { ...session.context.variables, ...args.variables }
        if (args.last_active_agent) session.context.lastActiveAgent = args.last_active_agent
        if (args.working_directory) session.context.workingDirectory = args.working_directory
        
        session.updatedAt = new Date().toISOString()
        
        writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
      } catch (e: any) {
        console.error(`Failed to auto-save session: ${e.message}`)
      }
    }, 5000)
    
    return JSON.stringify({
      session_id: args.session_id,
      message: "Context update scheduled (auto-saved with debounce)",
    }, null, 2)
  },
})

/**
 * Force immediate save of session context
 */
export const saveSession = tool({
  description: "Force immediate save of a session",
  args: {
    session_id: tool.schema.string().describe("The session ID to save"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    // Clear any pending debounced save
    const timer = debounceTimers.get(`session_${args.session_id}`)
    if (timer) {
      clearTimeout(timer)
      debounceTimers.delete(`session_${args.session_id}`)
    }
    
    // Touch the file to update timestamp
    const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
    session.updatedAt = new Date().toISOString()
    writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
    
    return JSON.stringify({
      session_id: args.session_id,
      updated_at: session.updatedAt,
      message: "Session saved immediately",
    }, null, 2)
  },
})

/**
 * Restore a session context
 */
export const restoreSession = tool({
  description: "Restore session context and optionally merge with current session",
  args: {
    session_id: tool.schema.string().describe("The session ID to restore"),
    merge_strategy: tool.schema.enum(["replace", "merge", "append"]).optional().describe("How to merge with current context: replace (clear and load), merge (combine), append (add to existing)").default("merge"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    try {
      const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))

      // Set as current session
      const index = loadIndex(context)
      index.currentSessionId = args.session_id
      index.lastModified = new Date().toISOString()
      saveIndex(context, index)
      
      // Mark as active if it was paused
      if (session.status === "paused") {
        session.status = "active"
        session.updatedAt = new Date().toISOString()
        writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
      }
      
      return JSON.stringify({
        restored_session_id: session.id,
        name: session.name,
        status: session.status,
        context: session.context,
        merge_strategy: args.merge_strategy,
        message: `Session ${session.id} restored successfully`,
      }, null, 2)
    } catch (e: any) {
      return JSON.stringify({ error: `Failed to restore session: ${e.message}` }, null, 2)
    }
  },
})

/**
 * Pause a session (mark as inactive but don't delete)
 */
export const pauseSession = tool({
  description: "Pause a session (marks as paused but preserves context)",
  args: {
    session_id: tool.schema.string().describe("The session ID to pause"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
    session.status = "paused"
    session.updatedAt = new Date().toISOString()
    writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
    
    // Clear from current if it was current
    const index = loadIndex(context)
    if (index.currentSessionId === args.session_id) {
      index.currentSessionId = null
      saveIndex(context, index)
    }
    
    return JSON.stringify({
      session_id: args.session_id,
      status: "paused",
      message: "Session paused successfully",
    }, null, 2)
  },
})

/**
 * Terminate a session (mark as terminated)
 */
export const terminateSession = tool({
  description: "Terminate a session permanently",
  args: {
    session_id: tool.schema.string().describe("The session ID to terminate"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
    session.status = "terminated"
    session.updatedAt = new Date().toISOString()
    writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
    
    // Clear from current if it was current
    const index = loadIndex(context)
    if (index.currentSessionId === args.session_id) {
      index.currentSessionId = null
      saveIndex(context, index)
    }
    
    return JSON.stringify({
      session_id: args.session_id,
      status: "terminated",
      message: "Session terminated permanently",
    }, null, 2)
  },
})

/**
 * Update session metadata
 */
export const updateSessionMetadata = tool({
  description: "Update metadata for a session",
  args: {
    session_id: tool.schema.string().describe("The session ID to update"),
    metadata: tool.schema.record(tool.schema.string(), tool.schema.any()).describe("Metadata to merge with existing"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
    session.metadata = { ...session.metadata, ...args.metadata }
    session.updatedAt = new Date().toISOString()
    writeFileSync(sessionPath, JSON.stringify(session, null, 2), "utf-8")
    
    return JSON.stringify({
      session_id: args.session_id,
      metadata: session.metadata,
      message: "Metadata updated successfully",
    }, null, 2)
  },
})

/**
 * Export a session for backup
 */
export const exportSession = tool({
  description: "Export a session as a JSON string for backup",
  args: {
    session_id: tool.schema.string().describe("The session ID to export"),
  },
  async execute(args, context) {
    const sessionPath = getSessionPath(context, args.session_id)
    
    if (!existsSync(sessionPath)) {
      return JSON.stringify({ error: `Session not found: ${args.session_id}` }, null, 2)
    }

    const content = readFileSync(sessionPath, "utf-8")
    return JSON.stringify({
      session_id: args.session_id,
      exported_at: new Date().toISOString(),
      data: JSON.parse(content),
      raw_json: content,
    }, null, 2)
  },
})

/**
 * Import a session from backup
 */
export const importSession = tool({
  description: "Import a session from a backup JSON string",
  args: {
    session_data: tool.schema.string().describe("The JSON string of the session to import"),
    overwrite: tool.schema.boolean().optional().describe("Overwrite if session ID already exists").default(false),
  },
  async execute(args, context) {
    let session: Session
    try {
      session = JSON.parse(args.session_data)
    } catch {
      return JSON.stringify({ error: "Invalid JSON session data" }, null, 2)
    }
    
    // Generate new ID to avoid conflicts unless overwrite is true
    const sessionPath = getSessionPath(context, session.id)
    const exists = existsSync(sessionPath)
    
    if (exists && !args.overwrite) {
      // Generate new ID
      const newId = generateId()
      session.id = newId
      session.createdAt = new Date().toISOString()
      session.updatedAt = new Date().toISOString()
    } else if (exists && args.overwrite) {
      session.updatedAt = new Date().toISOString()
    }
    
    ensureSessionsDir(context)
    writeFileSync(getSessionPath(context, session.id), JSON.stringify(session, null, 2), "utf-8")
    
    // Update index
    const index = loadIndex(context)
    if (!index.sessions.includes(session.id)) {
      index.sessions.push(session.id)
    }
    index.lastModified = new Date().toISOString()
    saveIndex(context, index)
    
    return JSON.stringify({
      session_id: session.id,
      imported_at: session.updatedAt,
      message: "Session imported successfully",
    }, null, 2)
  },
})

/**
 * Search sessions by metadata or content
 */
export const searchSessions = tool({
  description: "Search sessions by metadata values or context content",
  args: {
    query: tool.schema.string().describe("Search query"),
    search_type: tool.schema.enum(["metadata", "messages", "files", "all"]).optional().describe("What to search").default("all"),
  },
  async execute(args, context) {
    ensureSessionsDir(context)
    const index = loadIndex(context)
    const results: SessionSummary[] = []
    
    const query = args.query.toLowerCase()
    
    for (const sessionId of index.sessions) {
      const sessionPath = getSessionPath(context, sessionId)
      if (!existsSync(sessionPath)) continue
      
      try {
        const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
        let match = false
        
        if (args.search_type === "metadata" || args.search_type === "all") {
          const metadataStr = JSON.stringify(session.metadata).toLowerCase()
          if (metadataStr.includes(query)) match = true
        }
        
        if (!match && (args.search_type === "messages" || args.search_type === "all")) {
          if (session.context.messages.some(m => m.content.toLowerCase().includes(query))) {
            match = true
          }
        }
        
        if (!match && (args.search_type === "files" || args.search_type === "all")) {
          if (session.context.files.some(f => f.toLowerCase().includes(query))) {
            match = true
          }
        }
        
        if (match) {
          results.push({
            id: session.id,
            name: session.name,
            status: session.status,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            metadata: session.metadata,
          })
        }
      } catch {
        // Skip corrupted sessions
      }
    }
    
    return JSON.stringify({
      query: args.query,
      search_type: args.search_type,
      results,
      total: results.length,
    }, null, 2)
  },
})

/**
 * Get session statistics
 */
export const sessionStats = tool({
  description: "Get statistics about all sessions",
  args: {},
  async execute(_args, context) {
    ensureSessionsDir(context)
    const index = loadIndex(context)
    
    let totalMessages = 0
    let totalTasks = 0
    let activeSessions = 0
    let pausedSessions = 0
    let terminatedSessions = 0
    const sessionAges: number[] = []
    
    for (const sessionId of index.sessions) {
      const sessionPath = getSessionPath(context, sessionId)
      if (!existsSync(sessionPath)) continue
      
      try {
        const session: Session = JSON.parse(readFileSync(sessionPath, "utf-8"))
        totalMessages += session.context.messages.length
        totalTasks += session.context.taskHistory.length
        
        switch (session.status) {
          case "active": activeSessions++; break
          case "paused": pausedSessions++; break
          case "terminated": terminatedSessions++; break
        }
        
        const createdAt = new Date(session.createdAt).getTime()
        const age = Date.now() - createdAt
        sessionAges.push(age)
      } catch {
        // Skip corrupted
      }
    }
    
    const avgAge = sessionAges.length > 0
      ? sessionAges.reduce((a, b) => a + b, 0) / sessionAges.length
      : 0
    
    return JSON.stringify({
      total_sessions: index.sessions.length,
      active_sessions: activeSessions,
      paused_sessions: pausedSessions,
      terminated_sessions: terminatedSessions,
      total_messages: totalMessages,
      total_tasks: totalTasks,
      average_session_age_ms: avgAge,
      oldest_session_ms: sessionAges.length > 0 ? Math.max(...sessionAges) : 0,
      newest_session_ms: sessionAges.length > 0 ? Math.min(...sessionAges) : 0,
      index_last_modified: index.lastModified,
    }, null, 2)
  },
})

/**
 * Check daemon session persistence status
 */
export const daemonSessionStatus = tool({
  description: "Check daemon session persistence status for heartbeat integration",
  args: {},
  async execute(_args, context) {
    ensureSessionsDir(context)
    const index = loadIndex(context)
    
    // Get current session if exists
    let currentSession: any = null
    if (index.currentSessionId) {
      const sessionPath = getSessionPath(context, index.currentSessionId)
      if (existsSync(sessionPath)) {
        try {
          currentSession = JSON.parse(readFileSync(sessionPath, "utf-8"))
        } catch {
          // Ignore
        }
      }
    }
    
    // Check for any pending auto-saves
    const pendingSaves = Array.from(debounceTimers.keys()).length
    
    return JSON.stringify({
      daemon_mode: true,
      sessions_persistent: true,
      current_session_id: index.currentSessionId,
      total_sessions: index.sessions.length,
      pending_auto_saves: pendingSaves,
      last_index_modified: index.lastModified,
      current_session_status: currentSession?.status || null,
      current_session_updated: currentSession?.updatedAt || null,
    }, null, 2)
  },
})
