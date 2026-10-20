// -----------------------------------------------------------------------------
// The Kopia hub: the server read on a timer of the container (the interval
// chosen in the configuration, 30 seconds while a snapshot runs, for its
// progress); the states of the added devices published when they change, the
// scene events fired on the snapshots and on the overdue sources, and the
// views the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 15 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every source, added to Gladys or not — "a snapshot
// fails" spares the user one scene per device.
//
// The last snapshot seen of each source is kept in /data (src/store.js): a
// snapshot that failed while the integration or Gladys restarted is still
// announced, once.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildServerDevice,
  buildSourceDevice,
  hoursSince,
  overdueAfterMs,
  parseSourceId,
  serverIds,
  serverValues,
  sourceIds,
  sourceValues,
  stateOf,
} from './devices.js';
import { ERROR_KINDS, KopiaClient, KopiaError } from './kopia/client.js';
import { hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  formatTime,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'kopia-hub' });

export const WIDGET_KEY = 'kopia';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
// The same as guim31/gladys-duplicati, so that scenes read alike.
export const TRIGGERS = Object.freeze({
  SUCCEEDED: 'backup_succeeded',
  FAILED: 'backup_failed',
  OVERDUE: 'backup_overdue',
});

export const HUB_TIMINGS = {
  // While a snapshot runs: its progress and its end, read this often.
  runningPollMs: 30_000,
  // The snapshot list of a source is read again when its last snapshot
  // changes, and at least this often (retention deletes old ones).
  historyEveryMs: 3600_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Kopia again when the last read is older.
  freshMs: 15_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;

/** "1.2 GB", for a scene message. */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * The view of a source: its last snapshot, its last run (the last snapshot,
 * or a failure newer than it), its last success, whether it is overdue.
 */
export function viewOf(source, failure, history, { now, overdueHours, knownSuccess = null }) {
  const last = source.last;
  let lastRun = last ? { ...last, id: `s:${last.id}` } : null;
  if (failure && (!last || failure.begin > last.begin)) {
    // A snapshot that failed completely: no snapshot saved, only the task.
    lastRun = {
      id: `t:${Math.floor(failure.begin / 1000)}`,
      result: 'error',
      begin: failure.begin,
      end: failure.end,
      durationS: Math.max(0, Math.round((failure.end - failure.begin) / 1000)),
      errors: 1,
      message: failure.message,
    };
  }
  const candidates = [];
  if (last && last.result !== 'error') {
    candidates.push(last.end);
  }
  if (history?.lastSuccess) {
    candidates.push(history.lastSuccess);
  }
  // The last success already seen: retention may have deleted it since.
  if (knownSuccess !== null) {
    candidates.push(knownSuccess);
  }
  const lastSuccess = candidates.length > 0 ? Math.max(...candidates) : null;
  const view = {
    ...source,
    lastRun,
    lastSuccess,
    snapshots: history?.count ?? null,
  };
  const limit = overdueAfterMs(view, overdueHours);
  view.overdue = limit !== null && lastSuccess !== null && now - lastSuccess > limit;
  return view;
}

export class KopiaHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/kopia/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} views of the sources of the last read, by id */
    this.sources = new Map();
    /** @type {Map<string, { lastId: string|null, count: number, lastSuccess: number|null, at: number }>} */
    this.histories = new Map();
    this.activeId = null;
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { sources: {} };
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      url: typeof saved?.url === 'string' ? saved.url : null,
      sources: saved?.sources && typeof saved.sources === 'object' ? saved.sources : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.signature !== null && this.config.language !== config.language;
    const overdueChanged = this.config.overdueHours !== config.overdueHours;
    this.config = config;
    const signature = JSON.stringify([
      config.url,
      config.username,
      config.password,
      config.fingerprint,
    ]);
    if (signature !== this.signature) {
      if (config.url && this.saved.url !== config.url) {
        // Another server: what was seen of the previous one means nothing here.
        this.saved = { url: config.url, sources: {} };
        this.store.save(this.saved);
      }
      this.signature = signature;
      this.client =
        config.url && config.password && !(config.fingerprintTyped && !config.fingerprint)
          ? new KopiaClient({
              url: config.url,
              username: config.username,
              password: config.password,
              fingerprint: config.fingerprint,
              request: this.request,
            })
          : null;
      this.sources = new Map();
      this.histories = new Map();
      this.activeId = null;
      this.readAt = 0;
      this.error = null;
      this.polling = null;
    }
    if (languageChanged) {
      this.discovered = null; // new names for the Discovery tab
    }
    if (overdueChanged && this.readAt !== 0) {
      // A new threshold is not an event: the sources overdue by it are only recorded.
      for (const saved of Object.values(this.saved.sources)) {
        saved.overdue = null;
      }
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const delay = this.activeId ? this.timings.runningPollMs : this.config.pollIntervalMs;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Kopia works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, delay);
  }

  // --- Reading Kopia -----------------------------------------------------------

  /** Read the server now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let snapshot;
    try {
      snapshot = await this.fetch(client);
    } catch (err) {
      if (!(err instanceof KopiaError)) {
        throw err;
      }
      if (client !== this.client) {
        return false;
      }
      const changed = this.applyFailure(err);
      await this.publishStates(); // "Repository connected" goes to 0
      return changed;
    }
    return client === this.client && this.applySuccess(snapshot);
  }

  /** Everything Kopia says; the snapshot lists read only for the sources that changed. */
  async fetch(client) {
    const repository = await client.repository();
    if (!repository.connected) {
      throw new KopiaError(ERROR_KINDS.NO_REPOSITORY, 'Not connected to a repository');
    }
    const sources = await client.sources();
    const failures = await client.failures();
    const now = this.now();
    const histories = new Map();
    for (const source of sources) {
      const lastId = source.last?.id ?? null;
      const cached = this.histories.get(source.id);
      if (cached && cached.lastId === lastId && now - cached.at < this.timings.historyEveryMs) {
        histories.set(source.id, cached);
        continue;
      }
      try {
        histories.set(source.id, { lastId, ...(await client.history(source.source)), at: now });
      } catch (err) {
        // A busy server: keep what was read, try again next time.
        if (!(err instanceof KopiaError) || err.kind !== ERROR_KINDS.HTTP) {
          throw err;
        }
        logger.debug(`Snapshots of ${source.name} unreadable: ${err.message}`);
        histories.set(source.id, cached ? { ...cached, at: 0 } : null);
      }
    }
    return { sources, failures, histories };
  }

  async applySuccess({ sources, failures, histories }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info('Kopia answers again');
    }
    if (this.readAt === 0) {
      logger.info(`Kopia (${hostOf(this.config.url)}): ${sources.length} source(s)`);
    }
    this.error = null;
    const now = this.now();
    this.readAt = now;
    this.histories = new Map([...histories].filter(([, history]) => history));
    const active = sources.find((source) => source.running) ?? null;
    if ((active?.id ?? null) !== this.activeId) {
      widgetChanged = true;
    }
    this.activeId = active?.id ?? null;

    const next = new Map();
    let dirty = false;
    for (const source of sources) {
      if (next.has(source.id)) {
        continue;
      }
      const previousView = this.sources.get(source.id);
      if (source.last?.checkpoint) {
        // A checkpoint of the snapshot running: keep the last real one.
        source.last = previousView?.last ?? null;
      }
      // The last complete failure: from the tasks of Kopia, or as kept in
      // /data (Kopia forgets its tasks when it restarts).
      const live = failures.get(source.key) ?? null;
      const kept = this.saved.sources[source.id]?.failure ?? null;
      const failure = !kept || (live && live.begin >= kept.begin) ? live : kept;
      const view = viewOf(source, failure, histories.get(source.id), {
        now,
        overdueHours: this.config.overdueHours,
        knownSuccess: this.saved.sources[source.id]?.lastSuccess ?? null,
      });
      next.set(source.id, view);
      const previous = this.sources.get(source.id);
      if (
        !previous ||
        stateOf(previous) !== stateOf(view) ||
        previous.name !== view.name ||
        previous.lastSuccess !== view.lastSuccess ||
        (view.running && previous.progress !== view.progress)
      ) {
        widgetChanged = true;
      }
      dirty = (await this.transition(view)) || dirty;
    }
    if ([...this.sources.keys()].some((id) => !next.has(id))) {
      widgetChanged = true; // a source deleted
    }
    this.sources = next;
    // A source deleted in Kopia is forgotten.
    for (const id of Object.keys(this.saved.sources)) {
      if (!next.has(id)) {
        delete this.saved.sources[id];
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.saved.url = this.config.url;
      this.store.save(this.saved);
    }
    await this.publishStates();
    return widgetChanged;
  }

  applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Kopia: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  /**
   * Compare a source with what was seen before; fire the scene events of a
   * new snapshot and of a source turning overdue. The first sight of a source
   * only records. A run older than the one recorded is no news: the task of a
   * failure is lost when Kopia restarts, the snapshot before it comes back.
   * @returns {boolean} whether the saved state changed
   */
  async transition(source) {
    const saved = this.saved.sources[source.id];
    const run = source.lastRun;
    if (!saved) {
      this.saved.sources[source.id] = {
        run: run?.id ?? null,
        runAt: run?.begin ?? null,
        overdue: source.overdue,
        lastSuccess: source.lastSuccess,
        ...(run?.id.startsWith('t:')
          ? { failure: { begin: run.begin, end: run.end, message: run.message } }
          : {}),
      };
      return true;
    }
    let dirty = false;
    if (source.lastSuccess !== null && source.lastSuccess !== saved.lastSuccess) {
      saved.lastSuccess = source.lastSuccess;
      dirty = true;
    }
    if (run && run.id !== saved.run && (saved.runAt === null || run.begin > saved.runAt)) {
      saved.run = run.id;
      saved.runAt = run.begin;
      dirty = true;
      await this.fireRun(source);
    }
    if (run?.id.startsWith('t:') && saved.failure?.begin !== run.begin) {
      saved.failure = { begin: run.begin, end: run.end, message: run.message };
      dirty = true;
    }
    if (source.overdue !== saved.overdue) {
      // null: the threshold changed, nothing to announce.
      if (source.overdue && saved.overdue === false) {
        logger.info(`${source.name} is overdue`);
        await this.fire(TRIGGERS.OVERDUE, source, {
          hours_since_success: hoursSince(source, this.now()),
          last_success: formatTime(source.lastSuccess, this.config.language),
        });
      }
      saved.overdue = source.overdue;
      dirty = true;
    }
    return dirty;
  }

  async fireRun(source) {
    const run = source.lastRun;
    if (run.result === 'success') {
      await this.fire(TRIGGERS.SUCCEEDED, source, {
        duration_minutes: Math.round((run.durationS ?? 0) / 60),
        files: run.files ?? 0,
        size: formatBytes(run.sizeBytes),
        snapshots: source.snapshots ?? 0,
      });
      return;
    }
    logger.info(`${source.name}: snapshot failed`);
    await this.fire(TRIGGERS.FAILED, source, {
      message: run.message,
      errors: run.errors,
    });
  }

  async fire(key, source, extra = {}) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: sourceIds(this.gladys, source.id).device,
        source: source.name,
        ...extra,
      });
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    const language = this.config.language;
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    return [
      buildServerDevice(this.gladys, language),
      ...[...this.sources.values()].map((source) =>
        buildSourceDevice(this.gladys, source, language),
      ),
    ];
  }

  /** Publish the Discovery list when it changed (a source added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Kopia, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device.external_id);
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0) {
      return;
    }
    const noRepository = this.error?.kind === ERROR_KINDS.NO_REPOSITORY;
    if (this.error && !noRepository) {
      return;
    }
    const language = this.config.language;
    const now = this.now();
    const states = [];
    if (!this.error) {
      for (const source of this.sources.values()) {
        if (this.isCreated(sourceIds(this.gladys, source.id).device)) {
          for (const { key: _key, ...state } of sourceValues(this.gladys, source, language, now)) {
            states.push(state);
          }
        }
      }
    }
    if (this.isCreated(serverIds(this.gladys).device)) {
      const values = serverValues(this.gladys, {
        connected: !noRepository,
        sources: [...this.sources.values()],
        active: this.activeId ? (this.sources.get(this.activeId) ?? null) : null,
      });
      for (const { key: _key, ...state } of values) {
        states.push(state);
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const serverAnswers = !this.error || this.error.kind === ERROR_KINDS.NO_REPOSITORY;
    const entries = [];
    const badges = [
      [serverIds(this.gladys).device, serverAnswers],
      ...[...this.sources.keys()].map((id) => [sourceIds(this.gladys, id).device, !this.error]),
    ];
    for (const [externalId, reachable] of badges) {
      const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (!this.config.password) {
      return { connected: false, message: CONNECTION_TEXT.noPassword };
    }
    if (this.config.fingerprintTyped && !this.config.fingerprint) {
      return { connected: false, message: CONNECTION_TEXT.invalidFingerprint };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views and commands (widget, scene actions, report) ------------------------------

  /** The source of a device external id, null when it is not one (or no longer exists). */
  find(externalId) {
    const id = parseSourceId(this.gladys, externalId);
    return id ? (this.sources.get(id) ?? null) : null;
  }

  /** Throws the reason Kopia cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** The source of a device, read again if stale; throws a readable error. */
  async sourceOf(externalId) {
    // Only the configuration first: a past error is what the read below clears.
    if (!this.client) {
      this.assertReadable();
    }
    await this.refreshIfStale();
    this.assertReadable();
    const source = this.find(externalId);
    if (!source) {
      throw new Error(pick(ACTION_TEXT.unknownSource, this.config.language));
    }
    return source;
  }

  /** Start a snapshot now (unless disabled in the configuration), then read again. */
  async startSnapshot(source) {
    if (!this.config.allowStart) {
      throw new Error(pick(ACTION_TEXT.startDisabled, this.config.language));
    }
    try {
      await this.client.snapshot(source.source);
    } catch (err) {
      if (err instanceof KopiaError) {
        throw new Error(pick(ERROR_TEXT[err.kind], this.config.language), { cause: err });
      }
      throw err;
    }
    logger.info(`${source.name}: snapshot started from Gladys`);
    // Read again in the background, every 30 seconds while it runs.
    this.activeId = source.id;
    this.schedulePoll();
    (this.polling ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.pollNow())
      .catch((err) => logger.debug(`Read after start failed: ${err.message}`));
  }

  /** "Test the connection": read Kopia now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const sources = [...this.sources.values()];
      const parts = [text.ok, text.sources(sources.length)];
      const failed = sources.filter((source) => source.lastRun?.result === 'error').length;
      const overdue = sources.filter((source) => source.overdue).length;
      if (failed > 0) {
        parts.push(text.failed(failed));
      }
      if (overdue > 0) {
        parts.push(text.overdue(overdue));
      }
      message[language] = labelled('Kopia', parts.join(', '), language);
    }
    return message;
  }
}

export { ERROR_KINDS };
