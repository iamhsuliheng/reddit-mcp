# reddit-mcp

Cloudflare Worker MCP server for Reddit — read-only, anonymous mode (no API key required).

## Tools

10 read-only tools mirroring [jordanburke/reddit-mcp-server](https://github.com/jordanburke/reddit-mcp-server):

- `get_reddit_post` — Get a specific post by ID
- `get_top_posts` — Top posts from a subreddit or home feed
- `browse_subreddit` — Browse by sort (hot/new/top/rising/controversial)
- `get_post_comments` — Full comment threads with depth
- `search_reddit` — Keyword search across Reddit or a subreddit
- `get_subreddit_info` — Subreddit details and stats
- `get_trending_subreddits` — Currently popular subreddits
- `get_user_info` — User profile and karma
- `get_user_posts` — Posts by a user
- `get_user_comments` — Comments by a user

## Deploy

```bash
npm install
npx wrangler deploy
```

## MCP endpoint

`POST https://<worker-url>/mcp`
