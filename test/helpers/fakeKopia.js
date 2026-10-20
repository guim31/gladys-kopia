// -----------------------------------------------------------------------------
// An in-memory Kopia server: its sources rendered like the REST API (shapes
// checked against the real answers of test/fixtures/kopia in
// test/client.test.js), behind the same guard as the real one: Basic
// credentials on every request, and for the API the session cookie and the
// CSRF token of the web page.
//
// `snapshot()` records a snapshot the way Kopia does: a success, or files it
// could not read (a snapshot saved with `errorCount`), or a complete failure
// (no snapshot, a FAILED task only).
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.10:51515';
export const USERNAME = 'kopia';
export const PASSWORD = 'correct horse battery staple';
export const LOCAL = { userName: 'gladys', host: 'nas' };

const iso = (time) => new Date(time).toISOString();

export class FakeKopia {
  constructor() {
    /** @type {Map<string, object>} by path */
    this.sources = new Map();
    this.tasks = [];
    this.connected = true;
    /** 'down': the server does not answer; a number: that HTTP status for the API. */
    this.failure = null;
    this.requests = [];
    this.pages = 0;
    this.started = [];
    this.generation = 1;
    this.nextId = 1;
  }

  /** A source; `schedule` like the API ({ intervalSeconds }, { manual: true }…). */
  add(path, { schedule = { intervalSeconds: 86400 }, next = null, owner = LOCAL } = {}) {
    this.sources.set(path, {
      source: { host: owner.host, userName: owner.userName, path },
      schedule,
      next,
      status: 'IDLE',
      upload: null,
      snapshots: [],
    });
  }

  get(path) {
    return this.sources.get(path);
  }

  /**
   * A snapshot of `seconds`, ended at `end`: `success`, `error` (saved with
   * unreadable files) or `failed` (no snapshot, a FAILED task).
   */
  snapshot(
    path,
    result,
    { end, seconds = 60, files = 120, size = 1_234_567_890, errors = 1 } = {},
  ) {
    const source = this.get(path);
    const begin = end - seconds * 1000;
    const key = `${source.source.userName}@${source.source.host}:${path}`;
    const task = {
      id: String(this.tasks.length + 1),
      startTime: iso(begin),
      endTime: iso(end),
      kind: 'Snapshot',
      description: `${key} at ${iso(Math.floor(begin / 1000) * 1000).replace('.000', '')}`,
      status: result === 'failed' ? 'FAILED' : 'SUCCESS',
      progressInfo: '',
    };
    if (result === 'failed') {
      task.errorMessage = `unable to create local filesystem: lstat ${path}: no such file or directory`;
      this.tasks.unshift(task);
      return;
    }
    this.tasks.unshift(task);
    const failed = result === 'error' ? errors : 0;
    source.snapshots.push({
      id: (this.nextId++).toString(16).padStart(32, '0'),
      source: { ...source.source },
      description: '',
      startTime: iso(begin),
      endTime: iso(end),
      stats: {
        totalSize: size,
        fileCount: files,
        dirCount: 3,
        errorCount: failed,
        ignoredErrorCount: 0,
      },
      rootEntry: {
        name: path.split('/').pop(),
        type: 'd',
        summ: {
          size,
          files,
          dirs: 3,
          numFailed: failed,
          ...(failed > 0
            ? { errors: [{ path: 'secret.txt', error: 'unable to open file: permission denied' }] }
            : {}),
        },
      },
    });
  }

  /** A snapshot running, `progress` percent done. */
  run(path, progress = 40) {
    const source = this.get(path);
    source.status = 'UPLOADING';
    source.upload = { hashedBytes: progress, cachedBytes: 0, estimatedBytes: 100, errors: 0 };
  }

  idle(path) {
    const source = this.get(path);
    source.status = 'IDLE';
    source.upload = null;
  }

  /** Kopia restarted: its sessions are lost, and its task list. */
  restart() {
    this.generation += 1;
    this.tasks = [];
  }

  renderSource(source) {
    const last = source.snapshots.at(-1);
    return {
      source: source.source,
      status: source.status,
      schedule: { ...source.schedule, runMissed: true },
      ...(last ? { lastSnapshot: last } : {}),
      ...(source.next ? { nextSnapshotTime: iso(source.next) } : {}),
      ...(source.upload ? { upload: source.upload, currentTask: '9' } : {}),
    };
  }

  renderSnapshots(source) {
    return {
      snapshots: source.snapshots.map((snapshot) => ({
        id: snapshot.id,
        description: '',
        startTime: snapshot.startTime,
        endTime: snapshot.endTime,
        summary: snapshot.rootEntry.summ,
        rootID: 'k0',
        retention: [],
        pins: [],
      })),
      unfilteredCount: source.snapshots.length,
      uniqueCount: source.snapshots.length,
    };
  }

  token() {
    return `csrf-${this.generation}`;
  }

  /** The request seam of src/kopia/client.js. */
  request = async (address, { method = 'GET', headers = {} } = {}) => {
    const url = new URL(address);
    this.requests.push({ method, path: url.pathname + url.search, headers });
    if (this.failure === 'down') {
      throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    }
    const expected = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
    if (headers.authorization !== expected) {
      return { status: 401, headers: {}, body: 'Access denied.\n' };
    }
    if (url.pathname === '/') {
      this.pages += 1;
      return {
        status: 200,
        headers: { 'set-cookie': [`Kopia-Session-Cookie=s${this.generation}; Path=/`] },
        body: `<html><head><meta name="kopia-csrf-token" content="${this.token()}" /></head></html>`,
      };
    }
    if (
      headers.cookie !== `Kopia-Session-Cookie=s${this.generation}` ||
      headers['x-kopia-csrf-token'] !== this.token()
    ) {
      return { status: 401, headers: {}, body: 'Invalid or missing CSRF token.\n' };
    }
    if (typeof this.failure === 'number') {
      return { status: this.failure, headers: {}, body: 'Boom' };
    }
    const json = (data, status = 200) => ({ status, headers: {}, body: JSON.stringify(data) });
    const notConnected = () => json({ code: 'NOT_CONNECTED', error: 'not connected' }, 400);
    const path = url.pathname.replace('/api/v1', '');
    const query = Object.fromEntries(url.searchParams);
    const find = () =>
      [...this.sources.values()].find(
        (s) =>
          s.source.path === query.path &&
          s.source.host === query.host &&
          s.source.userName === query.userName,
      );
    if (path === '/repo/status' && method === 'GET') {
      return json(
        this.connected
          ? {
              connected: true,
              description: 'Repository in Filesystem: /repo',
              storage: 'filesystem',
            }
          : { connected: false, hostname: '', username: '' },
      );
    }
    if (!this.connected) {
      return notConnected();
    }
    if (path === '/sources' && method === 'GET') {
      return json({
        localUsername: LOCAL.userName,
        localHost: LOCAL.host,
        multiUser: true,
        sources: [...this.sources.values()].map((source) => this.renderSource(source)),
      });
    }
    if (path === '/tasks' && method === 'GET') {
      return json({ tasks: this.tasks });
    }
    if (path === '/snapshots' && method === 'GET') {
      const source = find();
      return json(source ? this.renderSnapshots(source) : { snapshots: [], unfilteredCount: 0 });
    }
    if (path === '/sources/upload' && method === 'POST') {
      const source = find();
      if (!source) {
        return json({ code: 'NOT_FOUND', error: 'no source matching the provided filters' }, 404);
      }
      this.started.push(query.path);
      const key = `${query.userName}@${query.host}:${query.path}`;
      return json({ sources: { [key]: { success: true } } });
    }
    return json({ code: 'NOT_FOUND', error: 'not found' }, 404);
  };
}
