# mcp-github

MCP server for GitHub data. Search repositories, get repo details, list issues, and look up user profiles via the GitHub REST API — no API key required for public data.

Part of the [Pipeworx](https://pipeworx.io) open MCP gateway.

## Tools

| Tool | Description |
|------|-------------|
| `search_repos` | Search GitHub repositories by keyword, sort by stars/forks/updated |
| `get_repo` | Get full details for a repository by owner/name |
| `list_repo_issues` | List open/closed issues for a repository |
| `get_user` | Get a GitHub user's public profile |

## Quick Start

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "https://gateway.pipeworx.io/github/mcp"]
    }
  }
}
```

Or use the CLI:

```bash
npx pipeworx use github
```

## License

MIT
