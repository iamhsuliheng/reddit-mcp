# reddit-mcp

Cloudflare Worker that proxies Reddit's public JSON API as an MCP server.

Deployed at: `https://reddit-mcp.<your-subdomain>.workers.dev/mcp`

## Tools (10)

- `get_reddit_post` — Get a specific post by ID
- `get_top_posts` — Top posts from a subreddit or home feed
- `browse_subreddit` — Browse by sort order (hot/new/top/rising/controversial)
- `get_post_comments` — Full comment tree for a post
- `search_reddit` — Search posts by keyword
- `get_subreddit_info` — Subreddit stats and description
- `get_trending_subreddits` — Currently popular subreddits
- `get_user_info` — Public profile and karma
- `get_user_posts` — Posts by a user
- `get_user_comments` — Comments by a user

## Architecture

Anonymous mode — uses Reddit's public `.json` endpoints, no API key required.
Cloudflare Worker acts as a proxy to bypass Claude's egress restrictions on reddit.com.

## Deploy

Push to `main` triggers GitHub Actions → `wrangler deploy`.
Requires `CLOUDFLARE_API_TOKEN` in repo secrets.
