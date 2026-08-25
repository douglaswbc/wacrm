import type { ToolMethod, ToolParameter } from './tools'

export interface ImportedCurlTool {
  method: ToolMethod
  endpointUrl: string
  headers: Record<string, string>
  queryParams: Record<string, string>
  parameters: ToolParameter[]
}

/** Parse the common, copy-pasted cURL forms into an editable AI tool draft. */
export function importCurl(command: string): ImportedCurlTool {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token) =>
    token.replace(/^("|')|("|')$/g, ''),
  ) ?? []
  if (tokens[0]?.toLowerCase() !== 'curl') throw new Error('Start with a cURL command.')

  let method: ToolMethod = 'GET'
  let url = ''
  let data = ''
  const headers: Record<string, string> = {}
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    const next = () => tokens[++index] ?? ''
    if (token === '-X' || token === '--request') {
      const value = next().toUpperCase()
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value)) method = value as ToolMethod
    } else if (token === '-H' || token === '--header') {
      const header = next()
      const colon = header.indexOf(':')
      if (colon > 0) headers[header.slice(0, colon).trim()] = header.slice(colon + 1).trim()
    } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
      data = next()
      if (method === 'GET') method = 'POST'
    } else if (!token.startsWith('-') && /^https?:\/\//i.test(token)) {
      url = token
    }
  }
  if (!url) throw new Error('No URL was found in this cURL command.')

  const parsed = new URL(url)
  const queryParams = Object.fromEntries(parsed.searchParams.entries())
  parsed.search = ''
  const parameters: ToolParameter[] = []
  if (data) {
    try {
      const body = JSON.parse(data) as Record<string, unknown>
      if (body && !Array.isArray(body)) {
        for (const [name, value] of Object.entries(body)) {
          parameters.push({ name, type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string', description: `Value for ${name}.`, required: true })
        }
      }
    } catch {
      // The endpoint and headers are still useful; the user can define body parameters manually.
    }
  }
  return { method, endpointUrl: parsed.toString(), headers, queryParams, parameters }
}
