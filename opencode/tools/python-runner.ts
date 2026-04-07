import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { writeFileSync, unlinkSync } from "fs"
import { join } from "path"

export default tool({
  description:
    "Execute a Python script and return its output. Use this for data processing, API calls, calculations, or any task that benefits from Python. The script runs in the project directory.",
  args: {
    script: tool.schema.string().describe("Python code to execute"),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Timeout in seconds (default: 30, max: 120)"),
    packages: tool.schema
      .string()
      .optional()
      .describe("Comma-separated pip packages to install before running"),
  },
  async execute(args, context) {
    const timeoutMs = Math.min((args.timeout || 30) * 1000, 120000)
    const scriptPath = join(context.directory, ".opencode", "_tmp_script.py")

    try {
      // Install packages if requested
      if (args.packages) {
        const pkgs = args.packages.split(",").map((p) => p.trim()).filter(Boolean)
        if (pkgs.length > 0) {
          try {
            execSync(`pip install ${pkgs.join(" ")}`, {
              timeout: 60000,
              encoding: "utf-8",
              cwd: context.directory,
            })
          } catch (e: any) {
            return `Failed to install packages: ${e.message}`
          }
        }
      }

      // Write script to temp file (avoids shell escaping issues)
      writeFileSync(scriptPath, args.script, "utf-8")

      // Execute
      const result = execSync(`python "${scriptPath}"`, {
        timeout: timeoutMs,
        encoding: "utf-8",
        cwd: context.directory,
        maxBuffer: 1024 * 1024, // 1MB output limit
      })

      return result.trim() || "[Script completed with no output]"
    } catch (e: any) {
      const stderr = e.stderr?.toString() || ""
      const stdout = e.stdout?.toString() || ""
      return `Script failed:\n${stderr}\n${stdout}`.trim()
    } finally {
      try {
        unlinkSync(scriptPath)
      } catch {}
    }
  },
})
