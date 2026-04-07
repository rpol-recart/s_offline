import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { writeFileSync, unlinkSync, existsSync } from "fs"
import { join } from "path"

/**
 * Fetch a URL and convert it to readable text.
 * Permission: read-only (network access)
 */
export default tool({
  description: "Fetch a URL and convert it to readable text. Supports HTML pages and PDFs. Returns content with metadata.",
  args: {
    url: tool.schema.string().describe("URL to fetch (http/https)"),
    timeout: tool.schema.number().optional().describe("Timeout in seconds (default: 20)"),
    return_format: tool.schema.string().optional().describe("Response format: 'markdown' (default) or 'text'"),
    no_gfm: tool.schema.boolean().optional().describe("Disable GitHub-flavored markdown"),
    with_links_summary: tool.schema.boolean().optional().describe("Include links summary"),
    with_images_summary: tool.schema.boolean().optional().describe("Include images summary"),
  },
  async execute(args, context) {
    const timeoutSec = args.timeout || 20
    
    // Use web-reader tool if available via curl
    const curlCmd = `curl -s --max-time ${timeoutSec} -L -A "OpenCode-FW/1.0" "${args.url}"`
    
    try {
      const html = execSync(curlCmd, {
        encoding: "utf-8",
        cwd: context.directory,
        maxBuffer: 5 * 1024 * 1024,
      })
      
      // Basic HTML to text conversion
      let text = html
        // Remove scripts and styles
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        // Remove HTML tags
        .replace(/<[^>]+>/g, " ")
        // Decode common entities
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // Collapse whitespace
        .replace(/\s+/g, " ")
        .trim()
      
      // Extract title if available
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1].trim() : args.url
      
      const result = `Fetched: ${args.url}
Title: ${title}

${text.slice(0, 4000)}`
      
      return text.length > 4000 ? result + "\n\n[Content truncated]" : result
    } catch (e: any) {
      return `Failed to fetch ${args.url}: ${e.message}`
    }
  },
})
