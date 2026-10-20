// -----------------------------------------------------------------------------
// Kopia client: the REST API of `kopia server start` (the one its web
// interface uses), checked against a real Kopia 0.23.1.
//
//   GET  /                              the web page: a session cookie and the
//                                       CSRF token (meta "kopia-csrf-token")
//   GET  /api/v1/repo/status            { connected, description, … }
//   GET  /api/v1/sources                the sources: status (IDLE, UPLOADING…),
//                                       schedule, last snapshot, next one
//   GET  /api/v1/tasks                  the recent tasks; a snapshot that fails
//                                       completely only shows here (FAILED)
//   GET  /api/v1/snapshots?userName=&host=&path=   the snapshots of a source
//   POST /api/v1/sources/upload?userName=&host=&path=   snapshot now
//
// Every call carries the Basic credentials of --server-username/password, and
// the API also wants the session cookie with its CSRF token: they are asked on
// the first call, and again when Kopia refuses them (it restarted).
//
// TLS: a certificate signed by a known authority is checked as usual; the
// self-signed certificate of `kopia server start --tls-generate-cert` is
// accepted only when its SHA-256 fingerprint matches the one configured (the
// way the Kopia clients pin it). Redirects are not followed.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  FINGERPRINT: 'fingerprint', // the certificate is not the one pinned
  AUTH: 'auth', // username or password refused
  NOT_KOPIA: 'not_kopia', // something answers, not a Kopia server
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  NO_REPOSITORY: 'no_repository', // the server is not connected to a repository
  NOT_FOUND: 'not_found', // the source no longer exists
  HTTP: 'http', // any other HTTP error
});

export class KopiaError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'KopiaError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** "AB:CD:…", "abcd…" or "sha256:abcd…": 64 lowercase hex digits, or null. */
export function normalizeFingerprint(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const hex = value
    .trim()
    .replace(/^sha-?256[:=\s]*/i, '')
    .replace(/[\s:]/g, '')
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** Open a TLS connection and check the certificate against the pinned fingerprint. */
function pinnedSocket(url, fingerprint, timeoutMs) {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const socket = tls.connect({
      host,
      port: Number(url.port || 443),
      servername: net.isIP(host) ? undefined : host,
      // Checked below, against the fingerprint, before anything is sent.
      rejectUnauthorized: false,
    });
    socket.setTimeout(timeoutMs, () =>
      socket.destroy(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })),
    );
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      const raw = socket.getPeerCertificate()?.raw;
      const actual = raw ? createHash('sha256').update(raw).digest('hex') : '';
      if (actual !== fingerprint) {
        socket.destroy();
        reject(Object.assign(new Error('Fingerprint mismatch'), { code: 'FINGERPRINT_MISMATCH' }));
        return;
      }
      socket.off('error', reject);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

/**
 * The one function that talks to the network. The client takes it as a
 * parameter: the tests replace it with an in-memory Kopia
 * (test/helpers/fakeKopia.js).
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
export async function httpRequest(
  address,
  { method = 'GET', headers = {}, body, timeoutMs = 15_000, fingerprint = null } = {},
) {
  const url = new URL(address);
  const secure = url.protocol === 'https:';
  const options = { method, headers, timeout: timeoutMs, agent: false };
  if (secure && fingerprint) {
    const socket = await pinnedSocket(url, fingerprint, timeoutMs);
    // No agent at all: with one (even `agent: false`), https opens its own
    // connection and ignores createConnection.
    delete options.agent;
    options.createConnection = () => socket;
  }
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(url, options, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          response.destroy(new Error('Response too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    const timeout = () =>
      request.destroy(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }));
    request.on('timeout', timeout);
    // `timeout` above is an idle timeout: a server that trickles bytes is cut here.
    const deadline = setTimeout(timeout, timeoutMs);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
    request.end(body);
  });
}

// --- Parsing ---------------------------------------------------------------------

/** An RFC 3339 date in ms, null otherwise (and for Go's zero time). */
export function parseDate(value) {
  if (typeof value !== 'string' || value.startsWith('0001-')) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

const integer = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : null);

/** The identity of a source, as Kopia writes it: "user@host:/path". */
export const sourceKey = ({ userName, host, path }) => `${userName}@${host}:${path}`;

/**
 * The id of a source in Gladys: a hash of its identity (a path holds any
 * character, and external ids are forever).
 */
export const sourceId = (source) =>
  createHash('sha256').update(sourceKey(source)).digest('hex').slice(0, 16);

/** "nope.txt: permission denied…", short. */
function firstError(errors) {
  const entry = Array.isArray(errors) ? errors[0] : null;
  if (!entry || typeof entry !== 'object') {
    return '';
  }
  const text = [entry.path, entry.error]
    .filter((part) => typeof part === 'string' && part)
    .join(': ');
  return clean(text);
}

const clean = (text) => {
  const line = typeof text === 'string' ? text.replace(/\s*\n\s*/g, ': ').trim() : '';
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
};

/**
 * A snapshot, from the `lastSnapshot` of /sources (a manifest: `stats`,
 * `rootEntry.summ`) or from /snapshots (`summary`), normalized; null when it
 * cannot be dated.
 *
 * Result: `error` when files could not be read (the snapshot is saved, without
 * them) or when it is incomplete (interrupted); `success` otherwise, the
 * errors its policy ignores included.
 */
export function normalizeSnapshot(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const begin = parseDate(data.startTime);
  if (begin === null) {
    return null;
  }
  const end = parseDate(data.endTime) ?? begin;
  const summary = data.rootEntry?.summ ?? data.summary ?? {};
  const stats = data.stats ?? {};
  const errors = integer(stats.errorCount) ?? integer(summary.numFailed) ?? 0;
  const incomplete = Boolean(data.incomplete || data.incompleteReason);
  // Kopia saves "checkpoint" manifests during a long upload: not a result.
  const checkpoint = [data.incomplete, data.incompleteReason].includes('checkpoint');
  const result = errors > 0 || incomplete ? 'error' : 'success';
  return {
    id: typeof data.id === 'string' ? data.id : String(begin),
    result,
    begin,
    end,
    durationS: Math.max(0, Math.round((end - begin) / 1000)),
    // The summary of the tree: `stats` only counts the files read again
    // (fileCount is 0 when nothing changed).
    sizeBytes: integer(summary.size) ?? integer(stats.totalSize),
    files: integer(summary.files) ?? integer(stats.fileCount),
    errors,
    incomplete,
    checkpoint,
    message: firstError(summary.errors) || (incomplete ? clean(String(data.incomplete)) : ''),
  };
}

/** The schedule of a source policy: its period in ms, null when it has none. */
export function periodOf(schedule) {
  if (!schedule || typeof schedule !== 'object' || schedule.manual === true) {
    return null;
  }
  const interval = Number(schedule.intervalSeconds);
  if (Number.isFinite(interval) && interval > 0) {
    return interval * 1000;
  }
  // Times of the day: daily. A cron schedule has no simple period.
  if (Array.isArray(schedule.timeOfDay) && schedule.timeOfDay.length > 0) {
    return 24 * 3_600_000;
  }
  return null;
}

/** Share of an upload done, 0 to 99, null when unknown. */
export function progressOf(upload) {
  if (!upload || typeof upload !== 'object') {
    return null;
  }
  const total = Number(upload.estimatedBytes);
  const done = Number(upload.hashedBytes ?? 0) + Number(upload.cachedBytes ?? 0);
  if (!(total > 0) || !Number.isFinite(done)) {
    return null;
  }
  return Math.min(99, Math.max(0, Math.floor((done / total) * 100)));
}

/**
 * One entry of /sources, normalized; null when it cannot be identified.
 * @param {object} item
 * @param {{ userName: string, host: string }} local the user and host of the server
 */
export function normalizeSource(item, local = {}) {
  const source = item?.source;
  if (
    !source ||
    typeof source.path !== 'string' ||
    !source.path ||
    typeof source.host !== 'string' ||
    typeof source.userName !== 'string'
  ) {
    return null;
  }
  const own = source.userName === local.userName && source.host === local.host;
  const running = item.status === 'UPLOADING';
  return {
    id: sourceId(source),
    key: sourceKey(source),
    source: { userName: source.userName, host: source.host, path: source.path },
    // The path alone for the sources of the server itself.
    name: own ? source.path : sourceKey(source),
    status: typeof item.status === 'string' ? item.status : 'IDLE',
    running,
    progress: running ? progressOf(item.upload) : null,
    periodMs: periodOf(item.schedule),
    nextRun: parseDate(item.nextSnapshotTime),
    last: normalizeSnapshot(item.lastSnapshot),
  };
}

/** /sources: `{ local: { userName, host }, sources: [...] }`. */
export function normalizeSources(data) {
  if (!data || !Array.isArray(data.sources)) {
    throw new KopiaError(ERROR_KINDS.NOT_KOPIA, 'The answer is not a list of sources');
  }
  const local = { userName: data.localUsername, host: data.localHost };
  return data.sources.map((item) => normalizeSource(item, local)).filter(Boolean);
}

const TASK_SOURCE = /^(.*) at \d{4}-\d{2}-\d{2}T[^ ]+$/;

/**
 * /tasks: the last snapshot that failed completely, per source key. Kopia
 * saves no snapshot then; the task (kept in memory by the server) is the only
 * trace, its description "user@host:/path at 2026-10-20T06:52:30Z".
 * @returns {Map<string, { begin, end, message }>}
 */
export function failedSnapshots(data) {
  const failures = new Map();
  for (const task of Array.isArray(data?.tasks) ? data.tasks : []) {
    if (task?.kind !== 'Snapshot' || task.status !== 'FAILED') {
      continue;
    }
    const match = typeof task.description === 'string' && task.description.match(TASK_SOURCE);
    const begin = parseDate(task.startTime);
    if (!match || begin === null) {
      continue;
    }
    const known = failures.get(match[1]);
    if (!known || known.begin < begin) {
      failures.set(match[1], {
        begin,
        end: parseDate(task.endTime) ?? begin,
        message: clean(task.errorMessage),
      });
    }
  }
  return failures;
}

/** /snapshots: their number, and the end of the last one without error. */
export function historyOf(data) {
  const snapshots = (Array.isArray(data?.snapshots) ? data.snapshots : [])
    .map(normalizeSnapshot)
    .filter((snapshot) => snapshot && !snapshot.checkpoint);
  const good = snapshots.filter((snapshot) => snapshot.result !== 'error');
  return {
    count: integer(data?.unfilteredCount) ?? snapshots.length,
    lastSuccess: good.length > 0 ? Math.max(...good.map((snapshot) => snapshot.end)) : null,
  };
}

const sourceQuery = ({ userName, host, path }) =>
  new URLSearchParams({ userName, host, path }).toString();

// --- Client ------------------------------------------------------------------------

export class KopiaClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} options.username --server-username
   * @param {string} options.password --server-password
   * @param {string|null} [options.fingerprint] SHA-256 of a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({
    url,
    username,
    password,
    fingerprint = null,
    request = httpRequest,
    timeoutMs = 15_000,
  }) {
    this.url = url;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.fingerprint = fingerprint;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.session = null; // { cookie, token }
  }

  async send(path, { method = 'GET', headers = {}, body } = {}) {
    try {
      return await this.request(`${this.url}${path}`, {
        method,
        headers: { authorization: this.authorization, ...headers },
        body,
        timeoutMs: this.timeoutMs,
        fingerprint: this.fingerprint,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (code === 'FINGERPRINT_MISMATCH') {
        throw new KopiaError(ERROR_KINDS.FINGERPRINT, 'Certificate fingerprint mismatch');
      }
      if (TLS_CODES.has(code)) {
        throw new KopiaError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new KopiaError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
  }

  static check(response, notFound = ERROR_KINDS.NOT_KOPIA) {
    const { status } = response;
    if (status >= 300 && status < 400) {
      throw new KopiaError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 401 || status === 403) {
      throw new KopiaError(ERROR_KINDS.AUTH, `Refused (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new KopiaError(notFound, 'Not found (HTTP 404)', { status });
    }
    if (status < 200 || status >= 300) {
      let code = '';
      try {
        code = JSON.parse(response.body)?.code ?? '';
      } catch {
        // not JSON
      }
      if (code === 'NOT_CONNECTED') {
        throw new KopiaError(ERROR_KINDS.NO_REPOSITORY, 'Not connected to a repository', {
          status,
        });
      }
      throw new KopiaError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
  }

  static json(response) {
    try {
      return JSON.parse(response.body);
    } catch {
      throw new KopiaError(ERROR_KINDS.NOT_KOPIA, 'The answer is not JSON');
    }
  }

  /** The web page: a session cookie and its CSRF token. */
  async openSession() {
    const response = await this.send('/', { headers: { accept: 'text/html' } });
    KopiaClient.check(response);
    const token = response.body.match(/name="kopia-csrf-token"\s+content="([^"]+)"/)?.[1];
    const cookies = [response.headers?.['set-cookie'] ?? []].flat();
    const session = cookies
      .map((cookie) => cookie.split(';')[0])
      .find((cookie) => cookie.startsWith('Kopia-Session-Cookie='));
    if (!token || !session) {
      throw new KopiaError(ERROR_KINDS.NOT_KOPIA, 'No Kopia session at this address');
    }
    this.session = { cookie: session, token };
  }

  /** An API call; opens the session again once when Kopia refuses it. */
  async call(path, { method = 'GET', notFound } = {}) {
    const attempt = async () => {
      if (!this.session) {
        await this.openSession();
      }
      return this.send(`/api/v1${path}`, {
        method,
        headers: {
          accept: 'application/json',
          cookie: this.session.cookie,
          'x-kopia-csrf-token': this.session.token,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        body: method === 'POST' ? '{}' : undefined,
      });
    };
    let response = await attempt();
    if (response.status === 401) {
      // The credentials were accepted for the page: the session expired (Kopia restarted).
      this.session = null;
      response = await attempt();
    }
    KopiaClient.check(response, notFound);
    return KopiaClient.json(response);
  }

  /** Whether the server is connected to its repository, and which one. */
  async repository() {
    const data = await this.call('/repo/status');
    if (typeof data?.connected !== 'boolean') {
      throw new KopiaError(ERROR_KINDS.NOT_KOPIA, 'The answer is not a repository status');
    }
    return {
      connected: data.connected,
      description: typeof data.description === 'string' ? data.description : '',
    };
  }

  async sources() {
    return normalizeSources(await this.call('/sources'));
  }

  async failures() {
    return failedSnapshots(await this.call('/tasks'));
  }

  async history(source) {
    return historyOf(await this.call(`/snapshots?${sourceQuery(source)}`));
  }

  /** Start a snapshot of a source now. */
  async snapshot(source) {
    const data = await this.call(`/sources/upload?${sourceQuery(source)}`, {
      method: 'POST',
      notFound: ERROR_KINDS.NOT_FOUND,
    });
    const answer = data?.sources?.[sourceKey(source)];
    if (answer && answer.success === false) {
      throw new KopiaError(ERROR_KINDS.HTTP, 'Snapshot refused');
    }
  }
}
