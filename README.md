# mcp-github

GitHub MCP — wraps the GitHub public REST API (no auth required for public endpoints)

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_repos` | Search GitHub repositories by keyword. Returns repo name, description, star count, forks, primary language, and URL. Use when exploring projects or finding code implementations. |
| `get_repo` | Look up ONE named repository by its owner/repo slug — "facebook/react", "torvalds/linux", "vercel/next.js". Use this whenever the repository is named in the question. Answers how many stars / forks / watchers a repo has, what license and language it uses, its topics, description, open issue count, and when it was last pushed. |
| `list_repo_issues` | List issues for a GitHub repository by owner and repo name; filters pull requests out automatically. Returns issue number, title, state, labels, author, comment count, URL, and timestamps. Defaults to open issues. |
| `get_user` | Get a GitHub user's public profile info. Returns name, bio, company, location, public repo count, followers, and social links. Specify username (e.g., username="torvalds"). |
| `get_file_contents` | Read a file from a PUBLIC GitHub repository (or list a directory) by path. PREFER OVER WEB SEARCH for "show me the README / package.json / <file> of <repo>", "read <path> from <owner/repo>", inspecting source or config files. Pass owner + repo + path (omit path or "" for the repo root listing). Optional ref = branch/tag/commit SHA. Returns decoded text for files (capped ~60k), or a directory listing of {name, path, type, size}. |
| `search_code` | Search CODE across public GitHub repositories — find where a function/symbol/string is defined or used. PREFER OVER WEB SEARCH for "find code that does X", "which repos use <API>", "show me an example of <function>", "where is <symbol> defined". Supports GitHub code-search qualifiers right in the query: repo:owner/name, org:name, user:name, language:go, filename:Dockerfile, path:src, extension:ts, in:file. Returns matching files with repo, path, and URL. Note: indexes the default branch only, ignores very common terms, and is capped at ~10 searches/minute. |
| `get_releases` | Get the latest release and recent release history for a repository — the canonical way to answer "what is the latest version of <project>", "when was <repo> last released", "what changed in the newest release". Returns the latest published stable release (tag, name, date, prerelease flag, release notes, downloadable assets with download counts) plus recent releases. Falls back to git tags for repos that tag but do not cut formal releases. |
| `list_commits` | List recent commits on a repository to see latest activity, what changed, and who is committing. PREFER OVER WEB SEARCH for "what are the recent commits to <repo>", "when was <owner/repo> last updated", "latest changes in <repo>". Optional sha (branch/tag/commit to start history from), path (only commits touching that file/dir), and since/until ISO timestamps. Returns sha, message, author, and date per commit. |
| `github_trending_repos` | Trending GitHub repositories — what is hot, popular, and taking off on GitHub right now. Answers "what are the top trending GitHub repos this week", "what is hot on GitHub today", "popular new repositories this month", "trending Rust / Python / AI projects", "which GitHub projects blew up recently". Two modes: mode="new" (default) ranks repositories CREATED inside the time window by star count — the projects that blew up this week — and mode="active" ranks repositories PUSHED inside the window by star count, surfacing established projects under heavy development. Set the window with since (day, week, or month), filter with language, add free-text query keywords such as "llm" or "agent", and raise a min_stars floor. Returns full_name, description, language, stars, forks, created and pushed dates, topics, and URL per repo. Computed live from the GitHub Search API; github.com/trending ranks by stars GAINED during the period using an unpublished algorithm that the public API keeps private, so ordering differs and every response says so in its caveat field. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "github": {
      "url": "https://gateway.pipeworx.io/github/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/github/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Github data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
