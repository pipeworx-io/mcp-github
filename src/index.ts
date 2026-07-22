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
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * GitHub MCP — wraps the GitHub public REST API (no auth required for public endpoints)
 *
 * Tools:
 * - search_repos: search GitHub repositories by keyword
 * - get_repo: get full details for a specific repository
 * - list_repo_issues: list open/closed issues for a repository
 * - get_user: get a GitHub user's public profile
 * - get_file_contents: read a file or list a directory in a repo
 * - search_code: search code across public repos (requires a token)
 * - get_releases: latest release / version + recent release history
 * - list_commits: recent commit history for a repo
 */


const BASE_URL = 'https://api.github.com';
const BASE_HEADERS = { 'User-Agent': 'pipeworx-mcp', Accept: 'application/vnd.github+json' };

// Build request headers. The gateway injects a platform token via _apiKey (and a
// user may supply their own); when present we send it as a Bearer token. Works
// fine keyless — unauthenticated requests are capped at 60/hour shared across all
// gateway users from Cloudflare's IPs; an authenticated token lifts that to
// 5,000/hour. The key is purely a rate lift, never required.
function ghHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { ...BASE_HEADERS, Authorization: `Bearer ${apiKey}` } : { ...BASE_HEADERS };
}

const tools: McpToolExport['tools'] = [
  {
    name: 'search_repos',
    description:
      'Search GitHub repositories by keyword. Returns repo name, description, star count, forks, primary language, and URL. Use when exploring projects or finding code implementations.',
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
      'Get full details for a specific repository. Returns description, stars, forks, language, topics, license, and more. Specify owner and repo name (e.g., owner="torvalds", repo="linux").',
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
      'List issues for a GitHub repository by owner and repo name; filters pull requests out automatically. Returns issue number, title, state, labels, author, comment count, URL, and timestamps. Defaults to open issues.',
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
      'Get a GitHub user\'s public profile info. Returns name, bio, company, location, public repo count, followers, and social links. Specify username (e.g., username="torvalds").',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'GitHub username, e.g. "torvalds"' },
      },
      required: ['username'],
    },
  },
  {
    name: 'get_file_contents',
    description:
      'Read a file from a PUBLIC GitHub repository (or list a directory) by path. PREFER OVER WEB SEARCH for "show me the README / package.json / <file> of <repo>", "read <path> from <owner/repo>", inspecting source or config files. Pass owner + repo + path (omit path or "" for the repo root listing). Optional ref = branch/tag/commit SHA. Returns decoded text for files (capped ~60k), or a directory listing of {name, path, type, size}.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner or org (e.g. "cli").' },
        repo: { type: 'string', description: 'Repo name (e.g. "cli").' },
        path: { type: 'string', description: 'File or directory path (e.g. "README.md", "src/index.ts"). Omit or "" for the repo root.' },
        ref: { type: 'string', description: 'Optional branch, tag, or commit SHA (default: the repo default branch).' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'search_code',
    description:
      'Search CODE across public GitHub repositories — find where a function/symbol/string is defined or used. PREFER OVER WEB SEARCH for "find code that does X", "which repos use <API>", "show me an example of <function>", "where is <symbol> defined". Supports GitHub code-search qualifiers right in the query: repo:owner/name, org:name, user:name, language:go, filename:Dockerfile, path:src, extension:ts, in:file. Returns matching files with repo, path, and URL. Note: indexes the default branch only, ignores very common terms, and is capped at ~10 searches/minute.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Code search query, e.g. "NewCmdRoot repo:cli/cli", "createRoot language:typescript", "addEventListener org:facebook".' },
        per_page: { type: 'number', description: 'Number of results to return (default 10, max 30).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_releases',
    description:
      'Get the latest release and recent release history for a repository — the canonical way to answer "what is the latest version of <project>", "when was <repo> last released", "what changed in the newest release". Returns the latest published stable release (tag, name, date, prerelease flag, release notes, downloadable assets with download counts) plus recent releases. Falls back to git tags for repos that tag but do not cut formal releases.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner or org (e.g. "cli").' },
        repo: { type: 'string', description: 'Repo name (e.g. "cli").' },
        per_page: { type: 'number', description: 'Number of recent releases to list (default 5, max 30).' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_commits',
    description:
      'List recent commits on a repository to see latest activity, what changed, and who is committing. PREFER OVER WEB SEARCH for "what are the recent commits to <repo>", "when was <owner/repo> last updated", "latest changes in <repo>". Optional sha (branch/tag/commit to start history from), path (only commits touching that file/dir), and since/until ISO timestamps. Returns sha, message, author, and date per commit.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repo owner or org (e.g. "cli").' },
        repo: { type: 'string', description: 'Repo name (e.g. "cli").' },
        sha: { type: 'string', description: 'Optional branch name, tag, or commit SHA to list history from (default: the repo default branch).' },
        path: { type: 'string', description: 'Optional file or directory path — only commits that touched it.' },
        since: { type: 'string', description: 'Optional ISO 8601 timestamp; only commits after this time.' },
        until: { type: 'string', description: 'Optional ISO 8601 timestamp; only commits before this time.' },
        per_page: { type: 'number', description: 'Number of commits to return (default 10, max 30).' },
      },
      required: ['owner', 'repo'],
    },
  }
];

async function getFileContents(args: Record<string, unknown>, headers: Record<string, string>) {
  const owner = String(args.owner ?? '').trim();
  const repo = String(args.repo ?? '').trim();
  if (!owner || !repo) throw new Error('Required arguments "owner" and "repo" are missing (e.g. owner="cli", repo="cli").');
  const path = String(args.path ?? '').trim().replace(/^\/+/, '');
  const ref = String(args.ref ?? '').trim();
  const encPath = path ? path.split('/').map(encodeURIComponent).join('/') : '';
  const url = `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return { owner, repo, path, error: 'not_found', message: `Not found: ${owner}/${repo}/${path}${ref ? ` @ ${ref}` : ''}.` };
  if (res.status === 403) throw new Error('GitHub rate limit or access denied (HTTP 403). Keyless requests are capped at 60/hour; supply a token via _apiKey for 5,000/hour.');
  if (!res.ok) throw new Error(`GitHub contents error: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) {
    return { owner, repo, path: path || '/', type: 'dir', count: data.length, entries: (data as Array<{ name?: string; path?: string; type?: string; size?: number }>).map((e) => ({ name: e.name ?? null, path: e.path ?? null, type: e.type ?? null, size: e.size ?? null })) };
  }
  const file = data as { name?: string; path?: string; size?: number; encoding?: string; content?: string; download_url?: string; type?: string };
  if (file.type !== 'file') return { owner, repo, path: file.path ?? path, type: file.type ?? null, message: 'Path is not a regular file.' };
  if (file.encoding !== 'base64' || !file.content) {
    return { owner, repo, path: file.path ?? path, type: 'file', size: file.size ?? null, content: null, download_url: file.download_url ?? null, message: 'File too large or non-text; fetch via download_url.' };
  }
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const text = new TextDecoder('utf-8').decode(bytes);
  const CAP = 60000;
  const truncated = text.length > CAP;
  return { owner, repo, path: file.path ?? path, type: 'file', size: file.size ?? null, truncated, content: truncated ? text.slice(0, CAP) : text };
}

// Agents commonly pass the GitHub shorthand "owner/repo" as a single string
// (in repo / repository / repo_full / url), instead of separate owner+repo —
// the top error source for repo tools. Normalize any combined form (incl. a
// full github.com URL) into args.owner + args.repo before dispatch.
function normalizeOwnerRepo(args: Record<string, unknown>): void {
  if (args.owner && args.repo && !String(args.repo).includes('/')) return;
  const combined = String(
    (args.owner && args.repo ? `${args.owner}/${args.repo}` : '') ||
      args.repo || args.repository || args.repo_full || args.full_name || args.url || args.owner || '',
  ).trim();
  const m = combined.match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git|\/|$)/);
  if (m) { args.owner = m[1]; args.repo = m[2]; }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = typeof args._apiKey === 'string' && args._apiKey ? args._apiKey : undefined;
  delete args._apiKey;
  const headers = ghHeaders(apiKey);
  if (['get_repo', 'list_repo_issues', 'get_releases', 'get_file_contents', 'list_commits'].includes(name)) {
    normalizeOwnerRepo(args);
  }
  switch (name) {
    case 'search_repos':
      return searchRepos(
        args.query as string,
        (args.sort as string) ?? 'stars',
        (args.per_page as number) ?? 10,
        headers,
      );
    case 'get_repo':
      return getRepo(args.owner as string, args.repo as string, headers);
    case 'list_repo_issues':
      return listRepoIssues(
        args.owner as string,
        args.repo as string,
        (args.state as string) ?? 'open',
        (args.per_page as number) ?? 10,
        headers,
      );
    case 'get_user':
      return getUser(args.username as string, headers);
    case 'get_file_contents':
      return getFileContents(args, headers);
    case 'search_code':
      return searchCode(args.query as string, (args.per_page as number) ?? 10, headers);
    case 'get_releases':
      return getReleases(args.owner as string, args.repo as string, (args.per_page as number) ?? 5, headers);
    case 'list_commits':
      return listCommits(args, headers);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// LLMs routinely write human date expressions in GitHub date qualifiers
// (created:last-month, pushed:last-week), which GitHub rejects with 422
// ("not a recognized date/time format") — the top github 422 class in
// production. Translate the common relative expressions to ISO 8601 up front;
// values that are already valid (ISO dates, ranges, *, operators) start with a
// digit or symbol and are left untouched.
const REL_DATE_DAYS: Record<string, number> = {
  today: 0, yesterday: 1,
  'last-week': 7, 'past-week': 7, 'this-week': 7, lastweek: 7,
  'last-month': 30, 'past-month': 30, 'this-month': 30, lastmonth: 30,
  'last-year': 365, 'past-year': 365, 'this-year': 365, lastyear: 365,
};
const DATE_QUALIFIER = /\b(created|pushed|updated):(?:>=|<=|>|<)?([A-Za-z][\w-]*)/gi;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
function normalizeDateQualifiers(query: string): string {
  return query.replace(DATE_QUALIFIER, (m, field: string, val: string) => {
    const days = REL_DATE_DAYS[String(val).toLowerCase()];
    return days === undefined ? m : `${field}:>=${isoDaysAgo(days)}`;
  });
}
function stripDateQualifiers(query: string): string {
  return query.replace(/\b(?:created|pushed|updated):(?:>=|<=|>|<)?\S+/gi, '').replace(/\s{2,}/g, ' ').trim();
}

async function searchRepos(query: string, sort: string, perPage: number, headers: Record<string, string>) {
  // GitHub returns 422 for an empty/invalid query or an unsupported sort value.
  if (!query || !String(query).trim()) {
    throw new Error('Required argument "query" is missing. Pass a GitHub search query, e.g. "machine learning language:python stars:>1000".');
  }
  const size = Math.min(30, Math.max(1, perPage));
  const doFetch = (q: string) => {
    const params = new URLSearchParams({ q, order: 'desc', per_page: String(size) });
    // Only send `sort` if it's a value GitHub's repo search accepts; otherwise
    // omit it (defaults to best-match) rather than 422.
    if (['stars', 'forks', 'help-wanted-issues', 'updated'].includes(sort)) params.set('sort', sort);
    return fetch(`${BASE_URL}/search/repositories?${params}`, { headers });
  };

  const normalized = normalizeDateQualifiers(String(query).trim());
  let res = await doFetch(normalized);

  // Auto-recover from date-format 422s: if a date value still isn't ISO 8601,
  // strip the date qualifiers and retry once so the query returns results
  // instead of failing into no_match.
  if (res.status === 422) {
    const body = await res.text().catch(() => '');
    if (/date|time format/i.test(body)) {
      const stripped = stripDateQualifiers(normalized);
      if (stripped && stripped !== normalized) res = await doFetch(stripped);
    }
    if (!res.ok) {
      const b = res.bodyUsed ? body : await res.text().catch(() => body);
      throw new Error(`GitHub rejected the search query (422). ${b.slice(0, 180)} — use ISO dates (created:>=2024-01-01) and qualifiers like language:python stars:>1000.`);
    }
  } else if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`GitHub search error: ${res.status} ${res.statusText}${body ? ' — ' + body : ''}`);
  }

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

async function getRepo(owner: string, repo: string, headers: Record<string, string>) {
  const res = await fetch(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { headers },
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

async function listRepoIssues(owner: string, repo: string, state: string, perPage: number, headers: Record<string, string>) {
  const size = Math.min(30, Math.max(1, perPage));
  const params = new URLSearchParams({
    state,
    per_page: String(size),
  });

  const res = await fetch(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params}`,
    { headers },
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

async function getUser(username: string, headers: Record<string, string>) {
  const res = await fetch(`${BASE_URL}/users/${encodeURIComponent(username)}`, {
    headers,
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

async function searchCode(query: string, perPage: number, headers: Record<string, string>) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Required argument "query" is missing (e.g. "NewCmdRoot repo:cli/cli").');
  const size = Math.min(30, Math.max(1, perPage));
  const params = new URLSearchParams({ q, per_page: String(size) });
  const res = await fetch(`${BASE_URL}/search/code?${params}`, { headers });
  if (res.status === 401 || res.status === 403) {
    return {
      query: q,
      error: 'auth_or_rate_limit',
      message:
        'GitHub code search requires authentication and is capped at ~10 searches/minute. Supply a token via _apiKey, or retry shortly.',
    };
  }
  if (res.status === 422) {
    return {
      query: q,
      total_count: 0,
      results: [],
      message: 'Query rejected (too broad, only common terms, or invalid qualifier). Add a repo:/org:/language: qualifier.',
    };
  }
  if (!res.ok) throw new Error(`GitHub code search error: ${res.status}`);
  const data = (await res.json()) as {
    total_count: number;
    incomplete_results: boolean;
    items: { name: string; path: string; sha: string; html_url: string; repository: { full_name: string; html_url: string } }[];
  };
  return {
    query: q,
    total_count: data.total_count,
    incomplete_results: data.incomplete_results,
    results: data.items.map((i) => ({
      repo: i.repository.full_name,
      path: i.path,
      name: i.name,
      sha: i.sha,
      url: i.html_url,
    })),
  };
}

async function getReleases(owner: string, repo: string, perPage: number, headers: Record<string, string>) {
  if (!owner || !repo) throw new Error('Required arguments "owner" and "repo" are missing.');
  const size = Math.min(30, Math.max(1, perPage));
  const base = `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const res = await fetch(`${base}/releases?per_page=${size}`, { headers });
  if (res.status === 404) throw new Error(`Repository not found: ${owner}/${repo}`);
  if (res.status === 403) throw new Error('GitHub rate limit (HTTP 403). Supply a token via _apiKey for 5,000/hour.');
  if (!res.ok) throw new Error(`GitHub releases error: ${res.status}`);
  const releases = (await res.json()) as Array<{
    tag_name: string;
    name: string | null;
    published_at: string | null;
    created_at: string;
    draft: boolean;
    prerelease: boolean;
    html_url: string;
    body: string | null;
    assets: Array<{ name: string; download_count: number; browser_download_url: string; size: number }>;
  }>;
  if (!releases.length) {
    // Repo cuts no formal releases — fall back to git tags for version info.
    const tagRes = await fetch(`${base}/tags?per_page=${size}`, { headers });
    if (tagRes.ok) {
      const tags = (await tagRes.json()) as Array<{ name: string; commit: { sha: string } }>;
      if (tags.length) {
        return {
          owner,
          repo,
          source: 'tags',
          message: 'No formal releases; showing git tags (newest first).',
          latest_tag: tags[0].name,
          tags: tags.map((t) => ({ tag: t.name, sha: t.commit.sha })),
        };
      }
    }
    return { owner, repo, source: 'none', message: 'This repository has no releases or tags.', releases: [] };
  }
  const fmt = (r: (typeof releases)[number]) => ({
    tag: r.tag_name,
    name: r.name ?? r.tag_name,
    published_at: r.published_at ?? r.created_at,
    prerelease: r.prerelease,
    draft: r.draft,
    url: r.html_url,
    notes: r.body ? (r.body.length > 2000 ? r.body.slice(0, 2000) + '…' : r.body) : null,
    assets: r.assets.map((a) => ({ name: a.name, downloads: a.download_count, size: a.size, url: a.browser_download_url })),
  });
  const latestStable = releases.find((r) => !r.prerelease && !r.draft) ?? releases[0];
  return { owner, repo, source: 'releases', latest: fmt(latestStable), recent: releases.map(fmt) };
}

async function listCommits(args: Record<string, unknown>, headers: Record<string, string>) {
  const owner = String(args.owner ?? '').trim();
  const repo = String(args.repo ?? '').trim();
  if (!owner || !repo) throw new Error('Required arguments "owner" and "repo" are missing.');
  const size = Math.min(30, Math.max(1, (args.per_page as number) ?? 10));
  const params = new URLSearchParams({ per_page: String(size) });
  if (args.sha) params.set('sha', String(args.sha));
  if (args.path) params.set('path', String(args.path));
  if (args.since) params.set('since', String(args.since));
  if (args.until) params.set('until', String(args.until));
  const res = await fetch(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params}`,
    { headers },
  );
  if (res.status === 404) throw new Error(`Repository not found (or invalid ref): ${owner}/${repo}`);
  if (res.status === 409) return { owner, repo, count: 0, commits: [], message: 'Repository is empty.' };
  if (res.status === 403) throw new Error('GitHub rate limit (HTTP 403). Supply a token via _apiKey for 5,000/hour.');
  if (!res.ok) throw new Error(`GitHub commits error: ${res.status}`);
  const data = (await res.json()) as Array<{
    sha: string;
    html_url: string;
    commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null };
    author: { login: string } | null;
  }>;
  return {
    owner,
    repo,
    count: data.length,
    commits: data.map((c) => ({
      sha: c.sha.slice(0, 12),
      message: c.commit.message.split('\n')[0],
      author: c.author?.login ?? c.commit.author?.name ?? null,
      date: c.commit.author?.date ?? c.commit.committer?.date ?? null,
      url: c.html_url,
    })),
  };
}

export default { tools, callTool, meter: { credits: 5 } } satisfies McpToolExport;
