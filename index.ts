/**
 * Reddit MCP Server — Cloudflare Worker
 * Read-only, anonymous mode (no Reddit API key required)
 * Implements 10 tools mirroring jordanburke/reddit-mcp-server read-only surface
 */

const USER_AGENT = "narrativesaw-reddit-mcp/1.0.0 (Cloudflare Worker; read-only)"
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const REDDIT_BASE = "https://www.reddit.com"
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

// ── Reddit fetch helper ──────────────────────────────────────────────────────

async function redditFetch(path: string): Promise<unknown> {
  const url = `${REDDIT_BASE}${path}`
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  })
  if (!res.ok) throw new Error(`Reddit ${res.status}: ${path}`)
  return res.json()
}

// ── Debug: test multiple Reddit access methods ───────────────────────────────

async function debugRedditAccess(): Promise<object> {
  const tests = [
    {
      name: "www.reddit.com .json (bot UA)",
      url: "https://www.reddit.com/r/technology/hot.json?limit=1",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    },
    {
      name: "www.reddit.com .json (browser UA)",
      url: "https://www.reddit.com/r/technology/hot.json?limit=1",
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    },
    {
      name: "old.reddit.com .json",
      url: "https://old.reddit.com/r/technology/hot.json?limit=1",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    },
    {
      name: "old.reddit.com .json (browser UA)",
      url: "https://old.reddit.com/r/technology/hot.json?limit=1",
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    },
    {
      name: "RSS feed",
      url: "https://www.reddit.com/r/technology/hot.rss?limit=1",
      headers: { "User-Agent": USER_AGENT },
    },
    {
      name: "api.reddit.com",
      url: "https://api.reddit.com/r/technology/hot?limit=1",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    },
    {
      name: "api.reddit.com (browser UA)",
      url: "https://api.reddit.com/r/technology/hot?limit=1",
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    },
  ]

  const results: any[] = []
  for (const t of tests) {
    try {
      const res = await fetch(t.url, { headers: t.headers, redirect: "follow" })
      const body = await res.text()
      results.push({
        name: t.name,
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type"),
        bodyPreview: body.slice(0, 200),
      })
    } catch (err: any) {
      results.push({ name: t.name, error: err.message })
    }
  }
  return { tests: results }
}

// ── Response shapers ─────────────────────────────────────────────────────────

function shapePost(d: any) {
  return {
    id: d.id,
    title: d.title,
    author: d.author,
    subreddit: d.subreddit,
    selftext: d.selftext || "",
    url: d.url,
    score: d.score,
    upvote_ratio: d.upvote_ratio,
    num_comments: d.num_comments,
    created_utc: d.created_utc,
    over18: d.over_18,
    permalink: `https://reddit.com${d.permalink}`,
    flair: d.link_flair_text ?? null,
  }
}

function shapeComment(d: any, depth = 0): any {
  return {
    id: d.id,
    author: d.author,
    body: d.body,
    score: d.score,
    created_utc: d.created_utc,
    edited: !!d.edited,
    is_submitter: d.is_submitter,
    permalink: d.permalink ? `https://reddit.com${d.permalink}` : null,
    depth,
  }
}

function flattenComments(children: any[], depth = 0): any[] {
  const result: any[] = []
  for (const item of children) {
    if (item.kind !== "t1" || !item.data?.body) continue
    result.push(shapeComment(item.data, depth))
    if (item.data.replies?.data?.children) {
      result.push(...flattenComments(item.data.replies.data.children, depth + 1))
    }
  }
  return result
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function tool_get_reddit_post(args: any) {
  const { post_id, subreddit } = args
  let data: any
  if (subreddit) {
    data = await redditFetch(`/r/${subreddit}/comments/${post_id}.json`)
    return shapePost(data[0].data.children[0].data)
  } else {
    data = await redditFetch(`/api/info.json?id=t3_${post_id}`)
    if (!data.data.children.length) throw new Error(`Post ${post_id} not found`)
    return shapePost(data.data.children[0].data)
  }
}

async function tool_get_top_posts(args: any) {
  const { subreddit = "", time_filter = "week", limit = 10 } = args
  const endpoint = subreddit ? `/r/${subreddit}/top.json` : "/top.json"
  const data: any = await redditFetch(`${endpoint}?t=${time_filter}&limit=${limit}`)
  return data.data.children.map((c: any) => shapePost(c.data))
}

async function tool_browse_subreddit(args: any) {
  const { subreddit = "", sort = "hot", time_filter = "week", limit = 10 } = args
  const validSorts = ["hot", "new", "top", "rising", "controversial"]
  if (!validSorts.includes(sort)) throw new Error(`Invalid sort "${sort}". Use: ${validSorts.join(", ")}`)
  const endpoint = subreddit ? `/r/${subreddit}/${sort}.json` : `/${sort}.json`
  const params = new URLSearchParams({ limit: String(limit) })
  if (sort === "top" || sort === "controversial") params.set("t", time_filter)
  const data: any = await redditFetch(`${endpoint}?${params}`)
  return data.data.children.map((c: any) => shapePost(c.data))
}

async function tool_get_post_comments(args: any) {
  const { post_id, subreddit, sort = "best", limit = 100 } = args
  const data: any = await redditFetch(`/r/${subreddit}/comments/${post_id}.json?sort=${sort}&limit=${limit}`)
  const post = shapePost(data[0].data.children[0].data)
  const comments = flattenComments(data[1].data.children)
  return { post, comments, total: comments.length }
}

async function tool_search_reddit(args: any) {
  const { query, subreddit, sort = "relevance", time_filter = "all", limit = 25 } = args
  const endpoint = subreddit ? `/r/${subreddit}/search.json` : "/search.json"
  const params = new URLSearchParams({ q: query, sort, t: time_filter, limit: String(limit), type: "link" })
  if (subreddit) params.set("restrict_sr", "true")
  const data: any = await redditFetch(`${endpoint}?${params}`)
  return data.data.children.filter((c: any) => c.kind === "t3").map((c: any) => shapePost(c.data))
}

async function tool_get_subreddit_info(args: any) {
  const data: any = await redditFetch(`/r/${args.subreddit}/about.json`)
  const d = data.data
  return {
    name: d.display_name,
    title: d.title,
    description: d.public_description,
    subscribers: d.subscribers,
    active_users: d.active_user_count ?? null,
    over18: d.over18,
    type: d.subreddit_type,
    url: `https://reddit.com${d.url}`,
    created_utc: d.created_utc,
  }
}

async function tool_get_trending_subreddits(args: any) {
  const { limit = 10 } = args
  const data: any = await redditFetch(`/subreddits/popular.json?limit=${limit}`)
  return data.data.children.map((c: any) => ({
    name: c.data.display_name,
    title: c.data.title,
    subscribers: c.data.subscribers,
    description: c.data.public_description,
    url: `https://reddit.com${c.data.url}`,
  }))
}

async function tool_get_user_info(args: any) {
  const data: any = await redditFetch(`/user/${args.username}/about.json`)
  const d = data.data
  return {
    name: d.name,
    comment_karma: d.comment_karma,
    link_karma: d.link_karma,
    total_karma: d.total_karma ?? d.comment_karma + d.link_karma,
    is_mod: d.is_mod,
    is_gold: d.is_gold,
    created_utc: d.created_utc,
    profile_url: `https://reddit.com/user/${d.name}`,
  }
}

async function tool_get_user_posts(args: any) {
  const { username, sort = "new", time_filter = "all", limit = 25 } = args
  const data: any = await redditFetch(`/user/${username}/submitted.json?sort=${sort}&t=${time_filter}&limit=${limit}`)
  return data.data.children.filter((c: any) => c.kind === "t3").map((c: any) => shapePost(c.data))
}

async function tool_get_user_comments(args: any) {
  const { username, sort = "new", time_filter = "all", limit = 25 } = args
  const data: any = await redditFetch(`/user/${username}/comments.json?sort=${sort}&t=${time_filter}&limit=${limit}`)
  return data.data.children
    .filter((c: any) => c.kind === "t1")
    .map((c: any) => ({
      id: c.data.id,
      author: c.data.author,
      body: c.data.body ?? "",
      score: c.data.score,
      subreddit: c.data.subreddit,
      submission_title: c.data.link_title ?? "",
      created_utc: c.data.created_utc,
      edited: !!c.data.edited,
      permalink: c.data.permalink ? `https://reddit.com${c.data.permalink}` : null,
    }))
}

// ── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_reddit_post",
    description: "Get a specific Reddit post by ID with engagement stats.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Reddit post ID (e.g. abc123)" },
        subreddit: { type: "string", description: "Subreddit name (optional, faster lookup)" },
      },
      required: ["post_id"],
    },
  },
  {
    name: "get_top_posts",
    description: "Get top posts from a subreddit or Reddit home feed.",
    inputSchema: {
      type: "object",
      properties: {
        subreddit: { type: "string", description: "Subreddit name (omit for home feed)" },
        time_filter: { type: "string", enum: ["hour", "day", "week", "month", "year", "all"], default: "week" },
        limit: { type: "number", description: "Max posts (1-100)", default: 10 },
      },
    },
  },
  {
    name: "browse_subreddit",
    description: "Browse a subreddit by sort order (hot, new, top, rising, controversial).",
    inputSchema: {
      type: "object",
      properties: {
        subreddit: { type: "string", description: "Subreddit name (omit for home feed)" },
        sort: { type: "string", enum: ["hot", "new", "top", "rising", "controversial"], default: "hot" },
        time_filter: { type: "string", enum: ["hour", "day", "week", "month", "year", "all"], default: "week", description: "Only applies to top/controversial" },
        limit: { type: "number", default: 10 },
      },
    },
  },
  {
    name: "get_post_comments",
    description: "Get comments from a Reddit post, with full threading depth.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string" },
        subreddit: { type: "string" },
        sort: { type: "string", enum: ["best", "top", "new", "controversial", "old", "qa"], default: "best" },
        limit: { type: "number", default: 100 },
      },
      required: ["post_id", "subreddit"],
    },
  },
  {
    name: "search_reddit",
    description: "Search Reddit posts by keyword. Optionally restrict to a subreddit.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        subreddit: { type: "string", description: "Restrict search to this subreddit (optional)" },
        sort: { type: "string", enum: ["relevance", "hot", "top", "new", "comments"], default: "relevance" },
        time_filter: { type: "string", enum: ["hour", "day", "week", "month", "year", "all"], default: "all" },
        limit: { type: "number", default: 25 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_subreddit_info",
    description: "Get details and statistics about a subreddit.",
    inputSchema: {
      type: "object",
      properties: {
        subreddit: { type: "string" },
      },
      required: ["subreddit"],
    },
  },
  {
    name: "get_trending_subreddits",
    description: "Get currently popular/trending subreddits.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
      },
    },
  },
  {
    name: "get_user_info",
    description: "Get public profile and karma stats for a Reddit user.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string" },
      },
      required: ["username"],
    },
  },
  {
    name: "get_user_posts",
    description: "Get posts submitted by a Reddit user.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string" },
        sort: { type: "string", enum: ["new", "hot", "top", "controversial"], default: "new" },
        time_filter: { type: "string", enum: ["hour", "day", "week", "month", "year", "all"], default: "all" },
        limit: { type: "number", default: 25 },
      },
      required: ["username"],
    },
  },
  {
    name: "get_user_comments",
    description: "Get comments made by a Reddit user.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string" },
        sort: { type: "string", enum: ["new", "hot", "top", "controversial"], default: "new" },
        time_filter: { type: "string", enum: ["hour", "day", "week", "month", "year", "all"], default: "all" },
        limit: { type: "number", default: 25 },
      },
      required: ["username"],
    },
  },
]

const TOOL_HANDLERS: Record<string, (args: any) => Promise<unknown>> = {
  get_reddit_post: tool_get_reddit_post,
  get_top_posts: tool_get_top_posts,
  browse_subreddit: tool_browse_subreddit,
  get_post_comments: tool_get_post_comments,
  search_reddit: tool_search_reddit,
  get_subreddit_info: tool_get_subreddit_info,
  get_trending_subreddits: tool_get_trending_subreddits,
  get_user_info: tool_get_user_info,
  get_user_posts: tool_get_user_posts,
  get_user_comments: tool_get_user_comments,
}

// ── MCP JSON-RPC handler ──────────────────────────────────────────────────────

function mcpError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: CORS_HEADERS })
}

function mcpResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: CORS_HEADERS })
}

async function handleMCP(req: Request): Promise<Response> {
  let body: any
  try {
    body = await req.json()
  } catch {
    return mcpError(null, -32700, "Parse error")
  }

  const { jsonrpc, id, method, params } = body
  if (jsonrpc !== "2.0") return mcpError(id, -32600, "Invalid Request")

  switch (method) {
    case "initialize":
      return mcpResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "reddit-mcp", version: "1.0.0" },
      })

    case "notifications/initialized":
      return new Response(null, { status: 204, headers: CORS_HEADERS })

    case "tools/list":
      return mcpResult(id, { tools: TOOLS })

    case "tools/call": {
      const { name, arguments: args = {} } = params ?? {}
      const handler = TOOL_HANDLERS[name]
      if (!handler) return mcpError(id, -32601, `Unknown tool: ${name}`)
      try {
        const result = await handler(args)
        return mcpResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        })
      } catch (err: any) {
        return mcpResult(id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        })
      }
    }

    case "ping":
      return mcpResult(id, {})

    default:
      return mcpError(id, -32601, `Method not found: ${method}`)
  }
}

// ── Worker entry ──────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        return new Response("POST only", { status: 405, headers: CORS_HEADERS })
      }
      return handleMCP(req)
    }

    if (url.pathname === "/debug") {
      const results = await debugRedditAccess()
      return Response.json(results, { headers: CORS_HEADERS })
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json(
        { status: "ok", service: "reddit-mcp", tools: TOOLS.length, mode: "anonymous" },
        { headers: CORS_HEADERS },
      )
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS })
  },
}
