interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * GitHub MCP — wraps the GitHub public REST API (no auth required for public endpoints)
 *
 * Tools:
 * - search_repos: search GitHub repositories by keyword
 * - get_repo: get full details for a specific repository
 * - list_repo_issues: list open/closed issues for a repository
 * - get_user: get a GitHub user's public profile
 */


const BASE_URL = 'https://api.github.com';
const HEADERS = { 'User-Agent': 'pipeworx-mcp', Accept: 'application/vnd.github+json' };

const tools: McpToolExport['tools'] = [
  {
    name: 'search_repos',
    description:
      'Search GitHub repositories by keyword. Returns name, full_name, description, stars, forks, language, and URL for the top results.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string (e.g., "react hooks", "cli tool language:go")' },
        sort: {
          type: 'string',
          description: 'Sort results by: stars, forks, or updated (default: stars)',
        },
        per_page: {
          type: 'number',
          description: 'Number of results to return (default 10, max 30)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_repo',
    description:
      'Get full details for a specific GitHub repository by owner and repo name. Returns description, stars, forks, language, topics, license, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (user or org), e.g. "facebook"' },
        repo: { type: 'string', description: 'Repository name, e.g. "react"' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_repo_issues',
    description:
      'List issues for a GitHub repository. Returns title, number, state, labels, and created_at for each issue.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (user or org)' },
        repo: { type: 'string', description: 'Repository name' },
        state: {
          type: 'string',
          description: 'Filter by issue state: open, closed, or all (default: open)',
        },
        per_page: {
          type: 'number',
          description: 'Number of issues to return (default 10, max 30)',
        },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'get_user',
    description:
      'Get the public profile of a GitHub user. Returns login, name, bio, company, location, public repos count, followers, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'GitHub username, e.g. "torvalds"' },
      },
      required: ['username'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_repos':
      return searchRepos(
        args.query as string,
        (args.sort as string) ?? 'stars',
        (args.per_page as number) ?? 10,
      );
    case 'get_repo':
      return getRepo(args.owner as string, args.repo as string);
    case 'list_repo_issues':
      return listRepoIssues(
        args.owner as string,
        args.repo as string,
        (args.state as string) ?? 'open',
        (args.per_page as number) ?? 10,
      );
    case 'get_user':
      return getUser(args.username as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function searchRepos(query: string, sort: string, perPage: number) {
  const size = Math.min(30, Math.max(1, perPage));
  const params = new URLSearchParams({
    q: query,
    sort,
    order: 'desc',
    per_page: String(size),
  });

  const res = await fetch(`${BASE_URL}/search/repositories?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GitHub search error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as {
    total_count: number;
    incomplete_results: boolean;
    items: {
      name: string;
      full_name: string;
      description: string | null;
      stargazers_count: number;
      forks_count: number;
      language: string | null;
      html_url: string;
      topics: string[];
      updated_at: string;
      open_issues_count: number;
    }[];
  };

  return {
    total_count: data.total_count,
    incomplete_results: data.incomplete_results,
    repos: data.items.map((r) => ({
      name: r.name,
      full_name: r.full_name,
      description: r.description ?? null,
      stars: r.stargazers_count,
      forks: r.forks_count,
      language: r.language ?? null,
      url: r.html_url,
      topics: r.topics ?? [],
      updated_at: r.updated_at,
      open_issues: r.open_issues_count,
    })),
  };
}

async function getRepo(owner: string, repo: string) {
  const res = await fetch(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { headers: HEADERS },
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Repository not found: ${owner}/${repo}`);
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    homepage: string | null;
    stargazers_count: number;
    forks_count: number;
    watchers_count: number;
    open_issues_count: number;
    language: string | null;
    topics: string[];
    default_branch: string;
    size: number;
    visibility: string;
    archived: boolean;
    fork: boolean;
    license: { spdx_id?: string; name?: string } | null;
    owner: { login: string; type: string };
    created_at: string;
    updated_at: string;
    pushed_at: string;
    subscribers_count: number;
    network_count: number;
  };

  return {
    name: data.name,
    full_name: data.full_name,
    description: data.description ?? null,
    url: data.html_url,
    homepage: data.homepage ?? null,
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.watchers_count,
    open_issues: data.open_issues_count,
    language: data.language ?? null,
    topics: data.topics ?? [],
    default_branch: data.default_branch,
    size_kb: data.size,
    visibility: data.visibility,
    archived: data.archived,
    is_fork: data.fork,
    license: data.license?.spdx_id ?? data.license?.name ?? null,
    owner: data.owner.login,
    owner_type: data.owner.type,
    created_at: data.created_at,
    updated_at: data.updated_at,
    pushed_at: data.pushed_at,
    subscribers: data.subscribers_count,
    network: data.network_count,
  };
}

async function listRepoIssues(owner: string, repo: string, state: string, perPage: number) {
  const size = Math.min(30, Math.max(1, perPage));
  const params = new URLSearchParams({
    state,
    per_page: String(size),
  });

  const res = await fetch(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params}`,
    { headers: HEADERS },
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Repository not found: ${owner}/${repo}`);
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    number: number;
    title: string;
    state: string;
    labels: { name: string; color: string }[];
    created_at: string;
    updated_at: string;
    html_url: string;
    user: { login: string } | null;
    pull_request?: unknown;
    comments: number;
    body: string | null;
  }[];

  // GitHub issues endpoint also returns pull requests — filter them out
  const issues = data.filter((item) => !item.pull_request);

  return {
    owner,
    repo,
    state,
    count: issues.length,
    issues: issues.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels.map((l) => l.name),
      author: i.user?.login ?? null,
      comments: i.comments,
      url: i.html_url,
      created_at: i.created_at,
      updated_at: i.updated_at,
    })),
  };
}

async function getUser(username: string) {
  const res = await fetch(`${BASE_URL}/users/${encodeURIComponent(username)}`, {
    headers: HEADERS,
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`User not found: ${username}`);
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    login: string;
    name: string | null;
    bio: string | null;
    company: string | null;
    location: string | null;
    email: string | null;
    blog: string | null;
    avatar_url: string;
    html_url: string;
    type: string;
    public_repos: number;
    public_gists: number;
    followers: number;
    following: number;
    created_at: string;
    updated_at: string;
    twitter_username: string | null;
  };

  return {
    login: data.login,
    name: data.name ?? null,
    bio: data.bio ?? null,
    company: data.company ?? null,
    location: data.location ?? null,
    email: data.email ?? null,
    blog: data.blog ?? null,
    twitter: data.twitter_username ?? null,
    avatar_url: data.avatar_url,
    url: data.html_url,
    type: data.type,
    public_repos: data.public_repos,
    public_gists: data.public_gists,
    followers: data.followers,
    following: data.following,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

export default { tools, callTool } satisfies McpToolExport;
