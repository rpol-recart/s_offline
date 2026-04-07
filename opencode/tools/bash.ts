import { tool } from "@opencode-ai/plugin"
import { execSync, ExecSyncOptions } from "child_process"
import { join } from "path"

/**
 * Execute a shell command in the current workspace.
 * Permission: danger-full-access (requires explicit allow)
 */
export default tool({
  description: "Execute a shell command in the current workspace. Use for system commands: pip, npm, python, make, curl, docker, ls, cat, etc. Do NOT use for git operations — use the dedicated 'git' tool instead. Do NOT use for file read/write — use 'read', 'write', 'edit' tools instead.",
  args: {
    command: tool.schema.string().describe("The shell command to execute"),
    timeout: tool.schema.number().optional().describe("Timeout in seconds (default: 30, max: 300)"),
    description: tool.schema.string().optional().describe("Description of what this command does"),
    dangerouslyDisableSandbox: tool.schema.boolean().optional().describe("Disable sandboxing (dangerous)"),
  },
  async execute(args, context) {
    const timeoutSec = Math.min(args.timeout || 30, 300)
    const options: ExecSyncOptions = {
      encoding: "utf-8",
      cwd: context.directory,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    }

    try {
      const result = execSync(args.command, {
        ...options,
        timeout: timeoutSec * 1000,
      })
      return (result as string).trim() || "[Command completed with no output]"
    } catch (e: any) {
      const stderr = e.stderr?.toString() || ""
      const stdout = e.stdout?.toString() || ""
      const code = e.status ?? "unknown"
      return `Command failed with exit code ${code}:\n${stderr}\n${stdout}`.trim()
    }
  },
})
