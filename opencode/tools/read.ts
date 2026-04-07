import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

/**
 * Read a text file from the workspace.
 * Permission: read-only
 */
export default tool({
  description: "Read the contents of a file. Supports offset and limit for reading specific portions of large files.",
  args: {
    filePath: tool.schema.string().describe("Absolute path to the file to read"),
    offset: tool.schema.number().optional().describe("Line number to start reading from (1-indexed)"),
    limit: tool.schema.number().optional().describe("Maximum number of lines to read"),
  },
  async execute(args, context) {
    // Resolve relative paths
    const resolvedPath = args.filePath.startsWith("/") 
      ? args.filePath 
      : join(context.directory, args.filePath)
    
    if (!existsSync(resolvedPath)) {
      return `Error: File not found: ${resolvedPath}`
    }
    
    try {
      const content = readFileSync(resolvedPath, "utf-8")
      const lines = content.split("\n")
      
      const start = args.offset ? Math.max(0, args.offset - 1) : 0
      const end = args.limit ? Math.min(lines.length, start + args.limit) : lines.length
      
      const selectedLines = lines.slice(start, end)
      const header = args.offset || args.limit 
        ? `[Lines ${start + 1}-${end} of ${lines.length}]\n` 
        : ""
      
      return header + selectedLines.join("\n")
    } catch (e: any) {
      return `Error reading file: ${e.message}`
    }
  },
})
