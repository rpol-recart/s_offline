import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { join } from "path"

/**
 * Execute docker commands in the workspace.
 * Permission: danger-full-access (requires explicit allow)
 */
export default tool({
  description: "Execute docker commands. Supports: images, ps, pull, run, build, stop, rm, logs, exec, compose.",
  args: {
    command: tool.schema.string().describe("Docker command to execute (without 'docker' prefix, e.g., 'ps -a', 'images')"),
    timeout: tool.schema.number().optional().describe("Timeout in seconds (default: 60)"),
  },
  async execute(args, context) {
    const timeoutSec = args.timeout || 60
    
    try {
      const result = execSync(`docker ${args.command}`, {
        encoding: "utf-8",
        cwd: context.directory,
        timeout: timeoutSec * 1000,
        maxBuffer: 10 * 1024 * 1024,
      })
      return result.trim() || "[Command completed with no output]"
    } catch (e: any) {
      const stderr = e.stderr?.toString() || ""
      const stdout = e.stdout?.toString() || ""
      return `Docker command failed:\n${stderr}\n${stdout}`.trim()
    }
  },
})

// Convenience sub-commands
export const ps = tool({
  description: "List running containers",
  args: {
    all: tool.schema.boolean().optional().describe("Show all containers (including stopped)"),
  },
  async execute(args, context) {
    const cmd = args.all ? "docker ps -a" : "docker ps"
    try {
      const result = execSync(cmd, { encoding: "utf-8", cwd: context.directory })
      return result.trim()
    } catch (e: any) {
      return `Docker not available: ${e.message}`
    }
  },
})

export const images = tool({
  description: "List local docker images",
  args: {},
  async execute(_args, context) {
    try {
      const result = execSync("docker images", { encoding: "utf-8", cwd: context.directory })
      return result.trim()
    } catch (e: any) {
      return `Docker not available: ${e.message}`
    }
  },
})
