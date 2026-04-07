import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"

// ============================================================================
// Types
// ============================================================================

export type TransportType = "stdio" | "http" | "websocket"

export interface MCPConfig {
  name: string
  transport: TransportType
  command?: string // For stdio
  args?: string[] // For stdio
  url?: string // For http/websocket
  auth?: {
    type: "oauth" | "bearer" | "none"
    token?: string
    clientId?: string
    clientSecret?: string
    authUrl?: string
    tokenUrl?: string
    scopes?: string[]
  }
  env?: Record<string, string>
  enabled?: boolean
}

export interface MCPServerInfo {
  name: string
  version?: string
  capabilities?: string[]
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface MCPResource {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export interface MCPResourceContent {
  uri: string
  mimeType?: string
  text?: string
  base64?: string
}

interface ServerConfigStore {
  servers: Record<string, MCPConfig>
  lastHash: string
  autoReconnect: boolean
  reconnectDelayMs: number
}

interface OAuthToken {
  access_token: string
  refresh_token?: string
  expires_in: number
  expires_at?: number
  token_type?: string
  scope?: string
}

// ============================================================================
// Constants
// ============================================================================

const MCP_SERVERS_PATH = ".opencode/mcp/servers.json"
const MCP_SERVERS_DIR = ".opencode/mcp"
const DEFAULT_RECONNECT_DELAY_MS = 5000
const DEFAULT_TOKEN_REFRESH_THRESHOLD_SECONDS = 300

// MCP Protocol JSON-RPC Constants
const JSONRPC_VERSION = "2.0"

// ============================================================================
// Config Management
// ============================================================================

function ensureMCPDirectory(directory: string): void {
  const dir = join(directory, MCP_SERVERS_DIR)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function getServersConfigPath(directory: string): string {
  return join(directory, MCP_SERVERS_PATH)
}

function computeConfigHash(config: MCPConfig): string {
  const normalized = JSON.stringify({
    name: config.name,
    transport: config.transport,
    command: config.command,
    args: config.args,
    url: config.url,
    auth: config.auth ? { type: config.auth.type } : null,
    env: config.env,
  })
  return createHash("sha256").update(normalized).digest("hex").substring(0, 16)
}

function loadServerConfigs(directory: string): ServerConfigStore {
  const path = getServersConfigPath(directory)
  ensureMCPDirectory(directory)

  if (!existsSync(path)) {
    return {
      servers: {},
      lastHash: "",
      autoReconnect: true,
      reconnectDelayMs: DEFAULT_RECONNECT_DELAY_MS,
    }
  }

  try {
    const data = readFileSync(path, "utf-8")
    return JSON.parse(data)
  } catch {
    return {
      servers: {},
      lastHash: "",
      autoReconnect: true,
      reconnectDelayMs: DEFAULT_RECONNECT_DELAY_MS,
    }
  }
}

function saveServerConfigs(directory: string, store: ServerConfigStore): void {
  const path = getServersConfigPath(directory)
  ensureMCPDirectory(directory)
  writeFileSync(path, JSON.stringify(store, null, 2), "utf-8")
}

// ============================================================================
// Stdio Transport
// ============================================================================

interface StdioTransportOptions {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface StdioTransport {
  type: "stdio"
  process?: ReturnType<typeof import("child_process").spawn>
  connected: boolean
  messageBuffer: string
  handlers: {
    onMessage: (message: unknown) => void
    onError: (error: Error) => void
    onClose: () => void
  }
}

function createStdioTransport(
  options: StdioTransportOptions,
  handlers: StdioTransport["handlers"]
): StdioTransport {
  const transport: StdioTransport = {
    type: "stdio",
    connected: false,
    messageBuffer: "",
    handlers,
  }

  try {
    const { spawn } = require("child_process")
    const childProcess = spawn(options.command, options.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
    })

    transport.process = childProcess

    childProcess.stdout?.on("data", (data: Buffer) => {
      transport.messageBuffer += data.toString()
      const lines = transport.messageBuffer.split("\n")
      transport.messageBuffer = lines.pop() || ""

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line)
            handlers.onMessage(message)
          } catch {
            // Ignore non-JSON lines
          }
        }
      }
    })

    childProcess.stderr?.on("data", (data: Buffer) => {
      const errorMsg = data.toString()
      if (errorMsg.trim()) {
        handlers.onError(new Error(errorMsg))
      }
    })

    childProcess.on("close", (code: number | null) => {
      transport.connected = false
      handlers.onClose()
    })

    childProcess.on("error", (err: Error) => {
      handlers.onError(err)
    })

    transport.connected = true
  } catch (error) {
    handlers.onError(error as Error)
  }

  return transport
}

function sendStdioMessage(transport: StdioTransport, message: unknown): void {
  if (transport.process?.stdin) {
    transport.process.stdin.write(JSON.stringify(message) + "\n")
  }
}

function closeStdioTransport(transport: StdioTransport): void {
  if (transport.process) {
    transport.process.kill()
    transport.process = undefined
  }
  transport.connected = false
}

// ============================================================================
// HTTP Transport
// ============================================================================

interface HTTPTransportOptions {
  url: string
  auth?: MCPConfig["auth"]
}

interface HTTPTransport {
  type: "http"
  url: string
  auth?: MCPConfig["auth"]
  connected: boolean
  eventSource?: EventSource
  pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>
  handlers: {
    onMessage: (message: unknown) => void
    onError: (error: Error) => void
    onClose: () => void
  }
}

function createHTTPTransport(
  options: HTTPTransportOptions,
  handlers: HTTPTransport["handlers"]
): HTTPTransport {
  const transport: HTTPTransport = {
    type: "http",
    url: options.url,
    auth: options.auth,
    connected: false,
    pendingRequests: new Map(),
    handlers,
  }

  // Note: Full EventSource/SSE implementation would require additional setup
  // This is a simplified HTTP transport with basic request/response support
  transport.connected = true

  return transport
}

async function httpRequest(
  transport: HTTPTransport,
  method: string,
  params?: unknown
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    transport.pendingRequests.set(requestId, { resolve, reject })

    const payload = {
      jsonrpc: JSONRPC_VERSION,
      id: requestId,
      method,
      params,
    }

    // Use fetch API for HTTP transport
    fetch(transport.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(transport.auth?.type === "bearer" && transport.auth.token
          ? { Authorization: `Bearer ${transport.auth.token}` }
          : {}),
      },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
        }
        const data = await response.json()
        transport.pendingRequests.delete(requestId)
        resolve(data)
      })
      .catch((error) => {
        transport.pendingRequests.delete(requestId)
        reject(error)
      })
  })
}

function closeHTTPTransport(transport: HTTPTransport): void {
  if (transport.eventSource) {
    transport.eventSource.close()
    transport.eventSource = undefined
  }
  transport.connected = false
  transport.pendingRequests.forEach((pending) => {
    pending.reject(new Error("Transport closed"))
  })
  transport.pendingRequests.clear()
}

// ============================================================================
// WebSocket Transport
// ============================================================================

interface WebSocketTransportOptions {
  url: string
  auth?: MCPConfig["auth"]
}

interface WebSocketTransport {
  type: "websocket"
  url: string
  auth?: MCPConfig["auth"]
  connected: boolean
  socket?: WebSocket
  pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>
  handlers: {
    onMessage: (message: unknown) => void
    onError: (error: Error) => void
    onClose: () => void
  }
}

function createWebSocketTransport(
  options: WebSocketTransportOptions,
  handlers: WebSocketTransport["handlers"]
): WebSocketTransport {
  const transport: WebSocketTransport = {
    type: "websocket",
    url: options.url,
    auth: options.auth,
    connected: false,
    pendingRequests: new Map(),
    handlers,
  }

  try {
    // Use native WebSocket if available
    const WS = globalThis.WebSocket || (globalThis as unknown as { require: (spec: string) => unknown }).require?.("ws")
    if (WS) {
      const socket = new (WS as new (url: string, protocols?: string | string[]) => WebSocket)(transport.url)
      transport.socket = socket

      socket.addEventListener("open", () => {
        transport.connected = true
      })

      socket.addEventListener("message", (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data)
          handlers.onMessage(message)
        } catch {
          handlers.onError(new Error("Failed to parse WebSocket message"))
        }
      })

      socket.addEventListener("error", (event: Event) => {
        handlers.onError(new Error(`WebSocket error: ${String(event)}`))
      })

      socket.addEventListener("close", () => {
        transport.connected = false
        handlers.onClose()
      })
    }
  } catch (error) {
    handlers.onError(error as Error)
  }

  return transport
}

function wsSend(transport: WebSocketTransport, method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!transport.socket || transport.socket.readyState !== WebSocket.OPEN) {
      reject(new Error("WebSocket not connected"))
      return
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    transport.pendingRequests.set(requestId, { resolve, reject })

    const payload = {
      jsonrpc: JSONRPC_VERSION,
      id: requestId,
      method,
      params,
    }

    transport.socket.send(JSON.stringify(payload))

    // Timeout for pending request
    setTimeout(() => {
      if (transport.pendingRequests.has(requestId)) {
        transport.pendingRequests.delete(requestId)
        reject(new Error(`Request ${requestId} timed out`))
      }
    }, 30000)
  })
}

function closeWebSocketTransport(transport: WebSocketTransport): void {
  if (transport.socket) {
    transport.socket.close()
    transport.socket = undefined
  }
  transport.connected = false
  transport.pendingRequests.forEach((pending) => {
    pending.reject(new Error("Transport closed"))
  })
  transport.pendingRequests.clear()
}

// ============================================================================
// MCP Client
// ============================================================================

type MCPActiveTransport = StdioTransport | HTTPTransport | WebSocketTransport

interface MCPClient {
  config: MCPConfig
  transport?: MCPActiveTransport
  connected: boolean
  reconnectTimer?: ReturnType<typeof setTimeout>
  oauthToken?: OAuthToken
}

const activeClients: Map<string, MCPClient> = new Map()

function createMCPClient(serverName: string, config: MCPConfig): MCPClient {
  return {
    config,
    connected: false,
  }
}

async function connectClient(
  client: MCPClient,
  directory: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const handlers = {
      onMessage: (message: unknown) => handleServerMessage(client, message),
      onError: (error: Error) => {
        console.error(`[MCP] ${client.config.name} error:`, error.message)
      },
      onClose: () => {
        client.connected = false
        handleDisconnect(client, directory)
      },
    }

    switch (client.config.transport) {
      case "stdio":
        if (!client.config.command) {
          return { success: false, error: "stdio transport requires 'command' parameter" }
        }
        client.transport = createStdioTransport(
          {
            command: client.config.command,
            args: client.config.args,
            env: client.config.env,
          },
          handlers
        )
        break

      case "http":
        if (!client.config.url) {
          return { success: false, error: "http transport requires 'url' parameter" }
        }
        client.transport = createHTTPTransport(
          {
            url: client.config.url,
            auth: client.config.auth,
          },
          handlers
        )
        break

      case "websocket":
        if (!client.config.url) {
          return { success: false, error: "websocket transport requires 'url' parameter" }
        }
        client.transport = createWebSocketTransport(
          {
            url: client.config.url,
            auth: client.config.auth,
          },
          handlers
        )
        break

      default:
        return { success: false, error: `Unsupported transport type: ${client.config.transport}` }
    }

    client.connected = true

    // Initialize with MCP handshake
    if (client.config.transport === "stdio") {
      sendInitializedNotification(client)
    } else {
      // For HTTP/WebSocket, send initialize request
      await sendRequest(client, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "opencode-mcp-client",
          version: "1.0.0",
        },
      })
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

function sendInitializedNotification(client: MCPClient): void {
  // Send initialize notification for stdio transport
  if (client.transport?.type === "stdio") {
    sendStdioMessage(client.transport, {
      jsonrpc: JSONRPC_VERSION,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "opencode-mcp-client",
          version: "1.0.0",
        },
      },
    })
  }
}

function handleServerMessage(client: MCPClient, message: unknown): void {
  // Handle incoming server messages
  if (typeof message === "object" && message !== null) {
    const msg = message as Record<string, unknown>
    // Handle responses to pending requests
    if (msg.id && client.transport) {
      // Response handling would go here
    }
    // Handle server-side notifications
    if (msg.method && !msg.id) {
      // Handle notification
    }
  }
}

function handleDisconnect(client: MCPClient, directory: string): void {
  const store = loadServerConfigs(directory)

  if (store.autoReconnect) {
    // Schedule reconnection
    client.reconnectTimer = setTimeout(async () => {
      const result = await connectClient(client, directory)
      if (!result.success) {
        console.error(`[MCP] Reconnection failed for ${client.config.name}: ${result.error}`)
      }
    }, store.reconnectDelayMs)
  }
}

async function sendRequest(
  client: MCPClient,
  method: string,
  params?: unknown
): Promise<unknown> {
  if (!client.transport) {
    throw new Error("Transport not initialized")
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

  switch (client.transport.type) {
    case "stdio":
      return new Promise((resolve, reject) => {
        if (!client.transport || client.transport.type !== "stdio") {
          reject(new Error("Invalid transport"))
          return
        }

        // For stdio, we track pending requests
        const pendingKey = `${method}_${requestId}`

        sendStdioMessage(client.transport, {
          jsonrpc: JSONRPC_VERSION,
          id: requestId,
          method,
          params,
        })

        // Timeout
        setTimeout(() => {
          reject(new Error(`Request ${method} timed out`))
        }, 30000)
      })

    case "http":
      return httpRequest(client.transport as HTTPTransport, method, params)

    case "websocket":
      return wsSend(client.transport as WebSocketTransport, method, params)

    default:
      throw new Error(`Unsupported transport type`)
  }
}

function disconnectClient(client: MCPClient): void {
  if (client.reconnectTimer) {
    clearTimeout(client.reconnectTimer)
    client.reconnectTimer = undefined
  }

  if (client.transport) {
    switch (client.transport.type) {
      case "stdio":
        closeStdioTransport(client.transport as StdioTransport)
        break
      case "http":
        closeHTTPTransport(client.transport as HTTPTransport)
        break
      case "websocket":
        closeWebSocketTransport(client.transport as WebSocketTransport)
        break
    }
    client.transport = undefined
  }

  client.connected = false
}

// ============================================================================
// OAuth Flow
// ============================================================================

async function performOAuthFlow(client: MCPClient): Promise<OAuthToken | null> {
  if (!client.config.auth || client.config.auth.type !== "oauth") {
    return null
  }

  const auth = client.config.auth

  if (!auth.clientId || !auth.authUrl || !auth.tokenUrl) {
    throw new Error("OAuth requires clientId, authUrl, and tokenUrl")
  }

  // PKCE flow
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: auth.clientId,
    redirect_uri: "http://localhost:8080/callback",
    scope: (auth.scopes || ["openid", "profile"]).join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  })

  const authUrl = `${auth.authUrl}?${authParams.toString()}`

  // In a real implementation, this would open a browser window
  // For now, we return the auth URL for manual authorization
  return {
    access_token: "", // Would be populated after callback
    refresh_token: "",
    expires_in: 3600,
  }
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(Array.from(array).map(b => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = new Uint8Array(hashBuffer)
  return btoa(Array.from(hashArray).map(b => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

async function refreshOAuthToken(client: MCPClient): Promise<boolean> {
  if (!client.oauthToken?.refresh_token || !client.config.auth) {
    return false
  }

  try {
    const response = await fetch(client.config.auth.tokenUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: client.oauthToken.refresh_token,
        client_id: client.config.auth.clientId!,
      }),
    })

    if (response.ok) {
      const tokenData = await response.json() as any
      client.oauthToken = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || client.oauthToken.refresh_token,
        expires_in: tokenData.expires_in,
        expires_at: Date.now() + tokenData.expires_in * 1000,
      }
      return true
    }
  } catch {
    // Token refresh failed
  }

  return false
}

// ============================================================================
// Tool Normalization
// ============================================================================

function normalizeToolName(serverName: string, toolName: string): string {
  // Convert MCP tool names to OpenCode format
  // e.g., "workspace/read_file" -> "mcp_workspace_read_file"
  const sanitized = toolName
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")

  return `mcp_${serverName.replace(/[^a-zA-Z0-9]/g, "_")}_${sanitized}`
}

function convertToolArgs(inputSchema: Record<string, unknown> | undefined, args: unknown): Record<string, unknown> {
  // Convert OpenCode tool arguments to MCP format
  if (!inputSchema || typeof inputSchema !== "object") {
    return args as Record<string, unknown> || {}
  }

  const properties = (inputSchema as Record<string, { type?: string }>).properties || {}
  const converted: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    // Type conversion logic could go here
    converted[key] = value
  }

  return converted
}

// ============================================================================
// MCP Client Tools
// ============================================================================

/**
 * Connect to an MCP server
 */
export const mcpConnect = tool({
  description: "Connect to a Model Context Protocol server",
  args: {
    server_name: tool.schema.string().describe("Unique name for this server connection"),
    transport: tool.schema
      .enum(["stdio", "http", "websocket"])
      .describe("Transport type for the MCP connection"),
    command: tool.schema.string().optional().describe("Command to execute (for stdio transport)"),
    args: tool.schema.array(tool.schema.string()).optional().describe("Command arguments (for stdio)"),
    url: tool.schema.string().optional().describe("URL endpoint (for http/websocket transports)"),
    auth_type: tool.schema.enum(["oauth", "bearer", "none"]).optional().describe("Authentication type"),
    auth_token: tool.schema.string().optional().describe("Bearer token for authentication"),
    env: tool.schema.record(tool.schema.string(), tool.schema.string()).optional().describe("Environment variables"),
  },
  async execute(args, context) {
    const store = loadServerConfigs(context.directory)

    const config: MCPConfig = {
      name: args.server_name,
      transport: args.transport,
      command: args.command,
      args: args.args,
      url: args.url,
      auth:
        args.auth_type && args.auth_type !== "none"
          ? {
              type: args.auth_type,
              token: args.auth_token,
            }
          : undefined,
      env: args.env,
      enabled: true,
    }

    // Check if already connected
    const existingClient = activeClients.get(args.server_name)
    if (existingClient?.connected) {
      return JSON.stringify({
        success: true,
        message: `Already connected to ${args.server_name}`,
        serverName: args.server_name,
      })
    }

    // Create or update client
    const client = createMCPClient(args.server_name, config)
    activeClients.set(args.server_name, client)

    // Handle OAuth if needed
    if (config.auth?.type === "oauth") {
      const oauthToken = await performOAuthFlow(client)
      if (oauthToken) {
        client.oauthToken = oauthToken
      }
    }

    const result = await connectClient(client, context.directory)

    if (result.success) {
      // Save config
      store.servers[args.server_name] = config
      store.lastHash = computeConfigHash(config)
      saveServerConfigs(context.directory, store)
    }

    return JSON.stringify({
      success: result.success,
      message: result.success
        ? `Connected to MCP server ${args.server_name}`
        : `Failed to connect: ${result.error}`,
      serverName: args.server_name,
      error: result.error,
    })
  },
})

/**
 * Disconnect from an MCP server
 */
export const mcpDisconnect = tool({
  description: "Disconnect from a Model Context Protocol server",
  args: {
    server_name: tool.schema.string().describe("Name of the server to disconnect from"),
  },
  async execute(args, context) {
    const client = activeClients.get(args.server_name)

    if (!client) {
      return JSON.stringify({
        success: false,
        message: `No active connection to ${args.server_name}`,
      })
    }

    disconnectClient(client)
    activeClients.delete(args.server_name)

    // Update config to mark as disabled
    const store = loadServerConfigs(context.directory)
    if (store.servers[args.server_name]) {
      store.servers[args.server_name].enabled = false
      saveServerConfigs(context.directory, store)
    }

    return JSON.stringify({
      success: true,
      message: `Disconnected from ${args.server_name}`,
      serverName: args.server_name,
    })
  },
})

/**
 * List available tools from connected MCP servers
 */
export const mcpListTools = tool({
  description: "List all available tools from connected MCP servers",
  args: {
    server_name: tool.schema.string().optional().describe("Filter by specific server name"),
  },
  async execute(args, context) {
    const store = loadServerConfigs(context.directory)
    const servers = args.server_name
      ? { [args.server_name]: store.servers[args.server_name] }
      : store.servers

    const allTools: Array<{
      server: string
      name: string
      normalizedName: string
      description?: string
      inputSchema?: Record<string, unknown>
    }> = []

    for (const [serverName, config] of Object.entries(servers)) {
      if (!config?.enabled) continue

      let client = activeClients.get(serverName)

      // Auto-connect if not connected
      if (!client?.connected) {
        client = createMCPClient(serverName, config)
        activeClients.set(serverName, client)
        const result = await connectClient(client, context.directory)
        if (!result.success) continue
      }

      try {
        const response = (await sendRequest(client, "tools/list", {})) as {
          tools?: Array<{
            name: string
            description?: string
            inputSchema?: Record<string, unknown>
          }>
        }

        const tools = response?.tools || []

        for (const tool of tools) {
          allTools.push({
            server: serverName,
            name: tool.name,
            normalizedName: normalizeToolName(serverName, tool.name),
            description: tool.description,
            inputSchema: tool.inputSchema,
          })
        }
      } catch (error) {
        console.error(`[MCP] Failed to list tools from ${serverName}:`, error)
      }
    }

    return JSON.stringify({
      tools: allTools,
      total: allTools.length,
      servers: Object.keys(servers).filter((s) => store.servers[s]?.enabled),
    }, null, 2)
  },
})

/**
 * Call an MCP tool
 */
export const mcpCallTool = tool({
  description: "Call a tool on a connected MCP server",
  args: {
    server_name: tool.schema.string().describe("Name of the MCP server"),
    tool_name: tool.schema.string().describe("Name of the tool to call"),
    arguments: tool.schema.record(tool.schema.string(), tool.schema.any()).optional().describe("Tool arguments"),
  },
  async execute(args, context) {
    const client = activeClients.get(args.server_name)

    if (!client?.connected) {
      // Try to reconnect
      const store = loadServerConfigs(context.directory)
      const config = store.servers[args.server_name]

      if (config?.enabled) {
        const newClient = createMCPClient(args.server_name, config)
        activeClients.set(args.server_name, newClient)
        const result = await connectClient(newClient, context.directory)
        if (!result.success) {
          return JSON.stringify({
            success: false,
            message: `Failed to reconnect to ${args.server_name}: ${result.error}`,
          }, null, 2)
        }
      } else {
        return JSON.stringify({
          success: false,
          message: `Server ${args.server_name} is not connected`,
        }, null, 2)
      }
    }

    const activeClient = activeClients.get(args.server_name)!

    try {
      // Get tool schema for argument conversion
      const toolsResponse = (await sendRequest(activeClient, "tools/list", {})) as {
        tools?: Array<{
          name: string
          inputSchema?: Record<string, unknown>
        }>
      }

      const toolSchema = toolsResponse?.tools?.find((t) => t.name === args.tool_name)
      const convertedArgs = convertToolArgs(toolSchema?.inputSchema, args.arguments || {})

      const response = await sendRequest(activeClient, "tools/call", {
        name: args.tool_name,
        arguments: convertedArgs,
      })

      return JSON.stringify({
        success: true,
        result: response,
      }, null, 2)
    } catch (error) {
      return JSON.stringify({
        success: false,
        message: `Tool call failed: ${String(error)}`,
        error: String(error),
      }, null, 2)
    }
  },
})

/**
 * List resources from connected MCP servers
 */
export const mcpListResources = tool({
  description: "List all available resources from connected MCP servers",
  args: {
    server_name: tool.schema.string().optional().describe("Filter by specific server name"),
  },
  async execute(args, context) {
    const store = loadServerConfigs(context.directory)
    const servers = args.server_name
      ? { [args.server_name]: store.servers[args.server_name] }
      : store.servers

    const allResources: Array<{
      server: string
      uri: string
      name?: string
      description?: string
      mimeType?: string
    }> = []

    for (const [serverName, config] of Object.entries(servers)) {
      if (!config?.enabled) continue

      const client = activeClients.get(serverName)

      if (!client?.connected) {
        // Auto-connect
        const newClient = createMCPClient(serverName, config)
        activeClients.set(serverName, newClient)
        const result = await connectClient(newClient, context.directory)
        if (!result.success) continue
      }

      try {
        const activeClient = activeClients.get(serverName)!
        const response = (await sendRequest(activeClient, "resources/list", {})) as {
          resources?: MCPResource[]
        }

        const resources = response?.resources || []

        for (const resource of resources) {
          allResources.push({
            server: serverName,
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          })
        }
      } catch (error) {
        console.error(`[MCP] Failed to list resources from ${serverName}:`, error)
      }
    }

    return JSON.stringify({
      resources: allResources,
      total: allResources.length,
    }, null, 2)
  },
})

/**
 * Read a resource from an MCP server
 */
export const mcpReadResource = tool({
  description: "Read a specific resource from an MCP server",
  args: {
    server_name: tool.schema.string().describe("Name of the MCP server"),
    uri: tool.schema.string().describe("Resource URI to read"),
  },
  async execute(args, context) {
    const client = activeClients.get(args.server_name)

    if (!client?.connected) {
      const store = loadServerConfigs(context.directory)
      const config = store.servers[args.server_name]

      if (config?.enabled) {
        const newClient = createMCPClient(args.server_name, config)
        activeClients.set(args.server_name, newClient)
        const result = await connectClient(newClient, context.directory)
        if (!result.success) {
          return JSON.stringify({
            success: false,
            message: `Failed to connect: ${result.error}`,
          }, null, 2)
        }
      } else {
        return JSON.stringify({
          success: false,
          message: `Server ${args.server_name} is not connected`,
        }, null, 2)
      }
    }

    const activeClient = activeClients.get(args.server_name)!

    try {
      const response = await sendRequest(activeClient, "resources/read", {
        uri: args.uri,
      })

      return JSON.stringify({
        success: true,
        resource: response,
      }, null, 2)
    } catch (error) {
      return JSON.stringify({
        success: false,
        message: `Failed to read resource: ${String(error)}`,
        error: String(error),
      }, null, 2)
    }
  },
})

/**
 * Configure MCP server settings
 */
export const mcpConfigure = tool({
  description: "Configure MCP server connection settings",
  args: {
    auto_reconnect: tool.schema.boolean().optional().describe("Enable auto-reconnect on disconnect"),
    reconnect_delay_ms: tool.schema.number().optional().describe("Delay before attempting reconnect (ms)"),
  },
  async execute(args, context) {
    const store = loadServerConfigs(context.directory)

    if (args.auto_reconnect !== undefined) {
      store.autoReconnect = args.auto_reconnect
    }

    if (args.reconnect_delay_ms !== undefined) {
      store.reconnectDelayMs = args.reconnect_delay_ms
    }

    saveServerConfigs(context.directory, store)

    return JSON.stringify({
      success: true,
      message: "MCP configuration updated",
      config: {
        autoReconnect: store.autoReconnect,
        reconnectDelayMs: store.reconnectDelayMs,
      },
    }, null, 2)
  },
})

/**
 * List configured MCP servers
 */
export const mcpListServers = tool({
  description: "List all configured MCP servers and their connection status",
  args: {},
  async execute(_args, context) {
    const store = loadServerConfigs(context.directory)

    const servers = Object.entries(store.servers).map(([name, config]) => ({
      name,
      transport: config.transport,
      url: config.url,
      command: config.command,
      enabled: config.enabled ?? true,
      connected: activeClients.get(name)?.connected ?? false,
      hasAuth: !!config.auth,
      authType: config.auth?.type,
    }))

    return JSON.stringify({
      servers,
      total: servers.length,
      autoReconnect: store.autoReconnect,
      reconnectDelayMs: store.reconnectDelayMs,
    }, null, 2)
  },
})

/**
 * Remove an MCP server configuration
 */
export const mcpRemoveServer = tool({
  description: "Remove an MCP server configuration",
  args: {
    server_name: tool.schema.string().describe("Name of the server to remove"),
  },
  async execute(args, context) {
    const store = loadServerConfigs(context.directory)

    // Disconnect if active
    const client = activeClients.get(args.server_name)
    if (client) {
      disconnectClient(client)
      activeClients.delete(args.server_name)
    }

    if (store.servers[args.server_name]) {
      delete store.servers[args.server_name]
      saveServerConfigs(context.directory, store)
      return JSON.stringify({
        success: true,
        message: `Server ${args.server_name} removed`,
      }, null, 2)
    }

    return JSON.stringify({
      success: false,
      message: `Server ${args.server_name} not found in configuration`,
    }, null, 2)
  },
})

/**
 * Get MCP integration status and statistics
 */
export const mcpStatus = tool({
  description: "Get MCP integration status, including feature flag state and active connections",
  args: {},
  async execute(_args, context) {
    const store = loadServerConfigs(context.directory)
    const activeConnections = Array.from(activeClients.entries())
      .filter(([, client]) => client.connected)
      .map(([name]) => name)

    return JSON.stringify({
      mcpIntegractionEnabled: true, // Always available
      configuredServers: Object.keys(store.servers).length,
      activeConnections: activeConnections.length,
      activeServerNames: activeConnections,
      autoReconnect: store.autoReconnect,
      reconnectDelayMs: store.reconnectDelayMs,
      serversConfigPath: getServersConfigPath(context.directory),
    }, null, 2)
  },
})

