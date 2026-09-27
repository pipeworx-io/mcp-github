interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    // Fleet #2382. Everything that isn't a timeout/abort here is a genuine
    // NETWORK-LEVEL failure — DNS resolution, connection refused, TLS handshake,
    // Cloudflare's own "Network connection lost." — meaning `fetch()` itself
    // threw and no HTTP response of any kind was ever received. Until this fix
    // that raw exception was rethrown VERBATIM: a bare `TypeError: fetch failed`
    // (or the Workers-runtime equivalent) names no upstream, carries no class
    // token, and reads exactly like a defect in OUR code — because it says
    // nothing about the call at all. It landed in `error`, the tier that means
    // "Pipeworx has a defect", for every one of the (at the time of writing)
    // ~470 packs that call this helper directly with no wrapper of their own.
    //
    // `dexscreener` hit this independently (fleet #1579) and fixed it with a
    // bespoke per-pack try/catch around `fetchWithTimeout`. That fix is correct
    // but only covers one pack; every other caller of this shared helper still
    // leaked the raw exception. Moving the same fix HERE — the one place that
    // already carries the timeout case — covers every pack that uses
    // `fetchWithTimeout` without a wrapper, for free, and without widening
    // `classifyToolError`'s regex list: the fix is giving the message a proper
    // `upstream_down:` token at the point the two facts (no response was ever
    // received, and which host we were trying to reach) are actually in hand,
    // not teaching the classifier to guess from prose after the fact.
    //
    // Safe on the same grounds as the timeout branch above: no argument a
    // caller passes can make `fetch()` itself throw a connection-level error,
    // so this is always an availability failure, never a caller mistake. Same
    // `markInternalOrigin` treatment — an origin we run that never answered is
    // still ours, not a third party's outage.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      markInternalOrigin(
        `upstream_down: could not reach ${name} at all (${raw.slice(0, 160)}). ` +
          `No request reached ${name}, so this says NOTHING about whether the arguments you passed ` +
          'are valid — do not re-check them on the strength of this error. Retry shortly.',
        url,
      ),
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
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
 * - github_trending_repos: what is hot on GitHub — repos created (or pushed) in a
 *   recent window, ranked by stars. Approximates github.com/trending; see the
 *   caveat in the handler for why it cannot reproduce it exactly.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'GitHub');
}

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
      'Search GitHub REPOSITORIES (whole projects) by keyword — find which projects exist for a topic, library or tool. Returns repo name, description, star count, forks, primary language, and URL. To search the files inside a repository (a function, a string, a config), search_code with repo:owner/name is the tool.',
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
    // Routing is embedding-based, so the phrasing people actually use has to be
    // IN here: "how many stars does facebook/react have" was going to
    // search_repos and coming back with fbsamples/f8app — a keyword hit for a
    // question that named its repository exactly. The owner/repo slug form is
    // the strongest signal a caller has already identified the repo.
    //
    // "default branch" added 2026-09-17 (fleet #2193): the tool has always
    // returned default_branch, but the description never said the two words a
    // "what's the default branch of <repo>" question actually uses, so it
    // never made the embedding candidate menu for that phrasing — gh_get_repo
    // (the OAuth-gated sibling, whose description does say "default branch")
    // won every one of those races and then 403'd every anonymous caller.
    description:
      'Look up ONE named repository by its owner/repo slug — "facebook/react", "torvalds/linux", "vercel/next.js". Use this whenever the repository is named in the question. Answers how many stars / forks / watchers a repo has, what license and language it uses, its topics, description, open issue count, its default branch, and when it was last pushed (pushed_at).',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (user or org), e.g. "facebook". May be omitted if `repo` carries the full "owner/repo" slug.' },
        repo: { type: 'string', description: 'Repository name, e.g. "react". Also accepts the full slug "facebook/react".' },
      },
      required: ['repo'],
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
  },
  {
    name: 'github_trending_repos',
    description:
      'Trending GitHub repositories — what is hot, popular, and taking off on GitHub right now. Answers "what are the top trending GitHub repos this week", "what is hot on GitHub today", "popular new repositories this month", "trending Rust / Python / AI projects", "which GitHub projects blew up recently". Two modes: mode="new" (default) ranks repositories CREATED inside the time window by star count — the projects that blew up this week — and mode="active" ranks repositories PUSHED inside the window by star count, surfacing established projects under heavy development. Set the window with since (day, week, or month), filter with language, add free-text query keywords such as "llm" or "agent", and raise a min_stars floor. Returns full_name, description, language, stars, forks, created and pushed dates, topics, and URL per repo. Computed live from the GitHub Search API; github.com/trending ranks by stars GAINED during the period using an unpublished algorithm that the public API keeps private, so ordering differs and every response says so in its caveat field.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description: 'Time window: "day" (last 24h), "week" (last 7 days, default), or "month" (last 30 days).',
        },
        mode: {
          type: 'string',
          description: 'Which window the date applies to: "new" (default) = repos CREATED in the window, ranked by stars — closest to "what blew up this week". "active" = repos PUSHED in the window, ranked by stars — big projects with recent commits.',
        },
        language: { type: 'string', description: 'Optional primary language filter, e.g. "python", "rust", "typescript".' },
        query: { type: 'string', description: 'Optional free-text keywords to narrow the topic, e.g. "llm", "agent framework", "kubernetes".' },
        min_stars: { type: 'number', description: 'Optional minimum star count. Useful with mode="active" to skip small repos.' },
        limit: { type: 'number', description: 'Number of repos to return (default 10, max 30).' },
      },
      required: [],
    },
  }
];

const TRENDING_WINDOW_DAYS: Record<string, number> = { day: 1, today: 1, daily: 1, week: 7, weekly: 7, month: 30, monthly: 30 };

// github.com/trending ranks by stars GAINED in the period — a metric GitHub has
// never exposed publicly. The Search API can only rank by TOTAL stars, so this
// tool computes the two honest approximations and labels which one it ran.
// Everything date-related is computed per call: a module-scope `new Date()`
// evaluates once at Worker startup (and reads as 1970 in the CF sandbox).
async function trendingRepos(args: Record<string, unknown>, headers: Record<string, string>) {
  const sinceRaw = String(args.since ?? 'week').trim().toLowerCase();
  const days = TRENDING_WINDOW_DAYS[sinceRaw] ?? 7;
  const since = days === 1 ? 'day' : days === 30 ? 'month' : 'week';
  const modeRaw = String(args.mode ?? 'new').trim().toLowerCase();
  const mode = ['active', 'pushed', 'updated'].includes(modeRaw) ? 'active' : 'new';
  const field = mode === 'active' ? 'pushed' : 'created';
  const windowStart = isoDaysAgo(days);
  const size = Math.min(30, Math.max(1, Number(args.limit ?? 10) || 10));

  const parts: string[] = [];
  const extra = String(args.query ?? '').trim();
  if (extra) parts.push(extra);
  parts.push(`${field}:>${windowStart}`);
  const language = String(args.language ?? '').trim();
  if (language) parts.push(`language:${language.includes(' ') ? `"${language}"` : language}`);
  const minStars = Number(args.min_stars ?? 0);
  if (Number.isFinite(minStars) && minStars > 0) parts.push(`stars:>=${Math.floor(minStars)}`);
  const q = parts.join(' ');

  const params = new URLSearchParams({ q, sort: 'stars', order: 'desc', per_page: String(size) });
  const res = await pwFetch(`${BASE_URL}/search/repositories?${params}`, { headers });
  if (res.status === 403 || res.status === 429) {
    return {
      found: false,
      reason: 'rate_limited',
      query: q,
      hint: 'GitHub search is capped at ~10 requests/minute without a token (30/minute with one). Retry shortly, or supply a GitHub token via _apiKey.',
    };
  }
  if (res.status === 422) {
    const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    return {
      found: false,
      reason: 'invalid_query',
      query: q,
      hint: `GitHub rejected the search (422)${body ? ' — ' + body : ''}. Try a simpler query, a real language name (e.g. language:python), and since = day, week, or month.`,
    };
  }
  if (!res.ok) throw await httpError(res, 'GitHub trending search error');

  const data = (await res.json()) as {
    total_count: number;
    incomplete_results: boolean;
    items: Array<{
      full_name: string;
      description: string | null;
      language: string | null;
      stargazers_count: number;
      forks_count: number;
      created_at: string;
      pushed_at: string;
      topics?: string[];
      html_url: string;
    }>;
  };

  const method =
    mode === 'active'
      ? `GitHub Search API: repositories pushed since ${windowStart}, ordered by total stars.`
      : `GitHub Search API: repositories created since ${windowStart}, ordered by total stars.`;
  const caveat =
    'This is computed from the GitHub Search API and ranked by TOTAL stars. It is a different measure from github.com/trending, which ranks by stars GAINED during the period using an algorithm GitHub keeps private and exposes through no API. Expect this list to differ from that page.';

  if (!data.items.length) {
    return {
      found: false,
      reason: 'no_results',
      mode,
      since,
      window_start: windowStart,
      query: q,
      method,
      caveat,
      hint: 'The window plus filters matched nothing. Widen since to "week" or "month", lower or drop min_stars, or remove the language / query filter.',
    };
  }

  return {
    found: true,
    mode,
    since,
    window_start: windowStart,
    ranked_by: 'total_stars',
    method,
    caveat,
    query: q,
    total_matching: data.total_count,
    count: data.items.length,
    repos: data.items.map((r) => ({
      full_name: r.full_name,
      description: r.description ?? null,
      language: r.language ?? null,
      stars: r.stargazers_count,
      forks: r.forks_count,
      created_at: r.created_at,
      pushed_at: r.pushed_at,
      topics: r.topics ?? [],
      url: r.html_url,
    })),
  };
}

async function getFileContents(args: Record<string, unknown>, headers: Record<string, string>) {
  const owner = String(args.owner ?? '').trim();
  const repo = String(args.repo ?? '').trim();
  if (!owner || !repo) throw new Error('Required arguments "owner" and "repo" are missing (e.g. owner="cli", repo="cli").');
  const path = String(args.path ?? '').trim().replace(/^\/+/, '');
  const ref = String(args.ref ?? '').trim();
  const encPath = path ? path.split('/').map(encodeURIComponent).join('/') : '';
  const url = `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const res = await pwFetch(url, { headers });
  if (res.status === 404) return { owner, repo, path, error: 'not_found', message: `Not found: ${owner}/${repo}/${path}${ref ? ` @ ${ref}` : ''}.` };
  if (res.status === 403) throw new Error('GitHub rate limit or access denied (HTTP 403). Keyless requests are capped at 60/hour; supply a token via _apiKey for 5,000/hour.');
  if (!res.ok) throw await httpError(res, 'GitHub contents error');
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
    case 'github_trending_repos':
      return trendingRepos(args, headers);
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
    return pwFetch(`${BASE_URL}/search/repositories?${params}`, { headers });
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
  const res = await pwFetch(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { headers },
  );
  if (!res.ok) {
    // A caller naming a repo that does not exist is the caller's mistake, not a
    // Pipeworx defect, so these 404s carry the `not_found:` routing token —
    // classifyToolError reads it and books them as `user_error` instead of
    // `error`, the tier the fleet triages as "we are broken". The gateway
    // strips the token before the caller sees the sentence.
    //
    // Fixed HERE rather than by widening the classifier to bare "not found"
    // prose, which is the standing policy after fleet #409/#450/#584/#637:
    // three dead endpoints (bundlephobia, fyyd, data-europa) report their
    // breakage in exactly that wording and are pinned as negative controls, so
    // a prose rule would hide real outages to fix a bookkeeping problem. The
    // token is an authored claim that this particular 404 means "no such
    // record", and for a repo GitHub names back to us it always does.
    //
    // The sentence says "or is private" rather than naming `_apiKey`, which
    // would be the more useful advice: keyArgFromMessage in the gateway finds
    // any key argument mentioned in an error string, and since github has a
    // platform-tier key that made every miss carry `signup_hint: "the
    // platform-tier key is unavailable right now"` -- an outage report attached
    // to a caller's typo. Naming a key argument here is not free.
    if (res.status === 404) throw new Error(`not_found: Repository not found: ${owner}/${repo}. GitHub answers 404 for a repository that does not exist, was renamed or deleted, or is private.`);
    throw await httpError(res, 'GitHub API error');
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

  const res = await pwFetch(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params}`,
    { headers },
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error(`not_found: Repository not found: ${owner}/${repo}. GitHub answers 404 for a repository that does not exist, was renamed or deleted, or is private.`);
    throw await httpError(res, 'GitHub API error');
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
  const res = await pwFetch(`${BASE_URL}/users/${encodeURIComponent(username)}`, {
    headers,
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`not_found: User not found: ${username}. GitHub has no user or organization with that login.`);
    throw await httpError(res, 'GitHub API error');
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
  const res = await pwFetch(`${BASE_URL}/search/code?${params}`, { headers });
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
  if (!res.ok) throw await httpError(res, 'GitHub code search error');
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
  const res = await pwFetch(`${base}/releases?per_page=${size}`, { headers });
  if (res.status === 404) throw new Error(`not_found: Repository not found: ${owner}/${repo}. GitHub answers 404 for a repository that does not exist, was renamed or deleted, or is private.`);
  if (res.status === 403) throw new Error('GitHub rate limit (HTTP 403). Supply a token via _apiKey for 5,000/hour.');
  if (!res.ok) throw await httpError(res, 'GitHub releases error');
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
    const tagRes = await pwFetch(`${base}/tags?per_page=${size}`, { headers });
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
  const res = await pwFetch(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${params}`,
    { headers },
  );
  if (res.status === 404) throw new Error(`not_found: Repository not found, or the ref does not exist: ${owner}/${repo}. GitHub answers 404 for a repository that does not exist, was renamed or deleted, or is private.`);
  if (res.status === 409) return { owner, repo, count: 0, commits: [], message: 'Repository is empty.' };
  if (res.status === 403) throw new Error('GitHub rate limit (HTTP 403). Supply a token via _apiKey for 5,000/hour.');
  if (!res.ok) throw await httpError(res, 'GitHub commits error');
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
