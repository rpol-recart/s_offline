import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { join } from "path"

/**
 * Execute git operations in the workspace.
 * Permission: workspace-write (for mutations)
 */
export default tool({
  description: "Execute git commands. The 'git' prefix is added automatically. Pass ONLY the subcommand: status, add, commit, push, pull, branch, checkout, log, diff, clone, stash, rebase, merge, tag. NEVER pass shell commands like 'cd', 'ls', 'cat' — those belong to the 'bash' tool.",
  args: {
    command: tool.schema.string().describe("Git subcommand WITHOUT 'git' prefix. Examples: 'status', 'add .', 'log --oneline -5', 'diff HEAD~1', 'commit -m \"fix bug\"'. WRONG: 'git status' (doubled prefix), 'cd /path' (not a git command), 'ls' (use bash)"),
    timeout: tool.schema.number().optional().describe("Timeout in seconds (default: 30)"),
  },
  async execute(args, context) {
    const timeoutSec = args.timeout || 30
    
    try {
      const result = execSync(`git ${args.command}`, {
        encoding: "utf-8",
        cwd: context.directory,
        timeout: timeoutSec * 1000,
        maxBuffer: 10 * 1024 * 1024,
      })
      return result.trim() || "[Command completed with no output]"
    } catch (e: any) {
      const stderr = e.stderr?.toString() || ""
      const stdout = e.stdout?.toString() || ""
      return `Git command failed:\n${stderr}\n${stdout}`.trim()
    }
  },
})

// Convenience sub-commands as named exports
export const status = tool({
  description: "Show git repository status",
  args: {},
  async execute(_args, context) {
    try {
      const result = execSync("git status", {
        encoding: "utf-8",
        cwd: context.directory,
      })
      return result.trim()
    } catch (e: any) {
      return `Not a git repository or git not installed: ${e.message}`
    }
  },
})

export const log = tool({
  description: "Show recent git commits",
  args: {
    limit: tool.schema.number().optional().describe("Number of commits to show (default: 10)"),
  },
  async execute(args, context) {
    const limit = args.limit || 10
    try {
      const result = execSync(`git log --oneline -n ${limit}`, {
        encoding: "utf-8",
        cwd: context.directory,
      })
      return result.trim()
    } catch (e: any) {
      return `Git log failed: ${e.message}`
    }
  },
})
