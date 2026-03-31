# mcp-github

GitHub MCP — wraps the GitHub public REST API (no auth required for public endpoints)

Part of the [Pipeworx](https://pipeworx.io) open MCP gateway.

## Tools

| Tool | Description |
|------|-------------|

## Quick Start

Add to your MCP client config:

```json
{
  "mcpServers": {
    "github": {
      "url": "https://gateway.pipeworx.io/github/mcp"
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
