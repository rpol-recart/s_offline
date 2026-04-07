import { tool } from "@opencode-ai/plugin"
import { writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"

/**
 * Write a text file in the workspace.
 * Permission: workspace-write
 */
export default tool({
  description: "Write content to a file. Creates parent directories if needed. Overwrites existing files.",
  args: {
    filePath: tool.schema.string().describe("Path to the file to write"),
    content: tool.schema.string().describe("Content to write to the file"),
  },
  async execute(args, context) {
    // Resolve relative paths
    const resolvedPath = args.filePath.startsWith("/") 
      ? args.filePath 
      : join(context.directory, args.filePath)
    
    try {
      // Ensure parent directory exists
      const dir = dirname(resolvedPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      
      writeFileSync(resolvedPath, args.content, "utf-8")
      return `File written successfully: ${resolvedPath}`
    } catch (e: any) {
      return `Error writing file: ${e.message}`
    }
  },
})
