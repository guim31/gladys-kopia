// -----------------------------------------------------------------------------
// The view of a Kopia source (what Kopia says, put together by src/hub.js) and
// the Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//
//   - one device per source (a path backed up), identified by a hash of
//     "user@host:/path":
//       state                text/text      "OK", "Failed", "Overdue"… (the
//                                           language of the configuration)
//       last_success         text/text      day/month hours:minutes
//       hours_since_success  duration/integer (h)
//       last_duration        duration/integer (s)   of the last snapshot
//       size                 data/size (MB)         of the last snapshot
//       files                counter-sensor/integer files of the last snapshot
//       snapshots            counter-sensor/integer snapshots kept
//       errors               counter-sensor/integer of the last snapshot
//       running              input/binary   1 while a snapshot of it runs
//       next_run             text/text      next scheduled snapshot, "-" if none
//
//   - one "Kopia" device for the server: the repository connected, a snapshot
//     running, its progress, its source, and the sources failed and overdue.
//
// Published with should_poll: false: the integration reads Kopia on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { STATE_TEXT, formatTime, pick } from './texts.js';

export const SOURCE_TYPE = 'source';
export const SERVER_TYPE = 'server';
export const SERVER_ID = 'main';
export const MODEL = 'Kopia';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  STATE: 'state',
  LAST_SUCCESS: 'last_success',
  HOURS_SINCE_SUCCESS: 'hours_since_success',
  LAST_DURATION: 'last_duration',
  SIZE: 'size',
  FILES: 'files',
  SNAPSHOTS: 'snapshots',
  ERRORS: 'errors',
  RUNNING: 'running',
  NEXT_RUN: 'next_run',
});

export const SERVER_KEYS = Object.freeze({
  REPOSITORY: 'repository_connected',
  RUNNING: 'running',
  PROGRESS: 'progress',
  CURRENT_SOURCE: 'current_source',
  FAILED: 'sources_failed',
  OVERDUE: 'sources_overdue',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.STATE]: 'State',
    [FEATURE_KEYS.LAST_SUCCESS]: 'Last successful snapshot',
    [FEATURE_KEYS.HOURS_SINCE_SUCCESS]: 'Hours since last success',
    [FEATURE_KEYS.LAST_DURATION]: 'Last snapshot duration',
    [FEATURE_KEYS.SIZE]: 'Size',
    [FEATURE_KEYS.FILES]: 'Files',
    [FEATURE_KEYS.SNAPSHOTS]: 'Snapshots',
    [FEATURE_KEYS.ERRORS]: 'Errors of the last snapshot',
    [FEATURE_KEYS.RUNNING]: 'Running',
    [FEATURE_KEYS.NEXT_RUN]: 'Next scheduled snapshot',
    [SERVER_KEYS.REPOSITORY]: 'Repository connected',
    [`server_${SERVER_KEYS.RUNNING}`]: 'Snapshot running',
    [SERVER_KEYS.PROGRESS]: 'Progress',
    [SERVER_KEYS.CURRENT_SOURCE]: 'Current source',
    [SERVER_KEYS.FAILED]: 'Failed sources',
    [SERVER_KEYS.OVERDUE]: 'Overdue sources',
  },
  fr: {
    [FEATURE_KEYS.STATE]: 'État',
    [FEATURE_KEYS.LAST_SUCCESS]: 'Dernier instantané réussi',
    [FEATURE_KEYS.HOURS_SINCE_SUCCESS]: 'Heures depuis la dernière réussite',
    [FEATURE_KEYS.LAST_DURATION]: 'Durée du dernier instantané',
    [FEATURE_KEYS.SIZE]: 'Taille',
    [FEATURE_KEYS.FILES]: 'Fichiers',
    [FEATURE_KEYS.SNAPSHOTS]: 'Instantanés',
    [FEATURE_KEYS.ERRORS]: 'Erreurs du dernier instantané',
    [FEATURE_KEYS.RUNNING]: 'En cours',
    [FEATURE_KEYS.NEXT_RUN]: 'Prochain instantané planifié',
    [SERVER_KEYS.REPOSITORY]: 'Dépôt connecté',
    [`server_${SERVER_KEYS.RUNNING}`]: 'Instantané en cours',
    [SERVER_KEYS.PROGRESS]: 'Progression',
    [SERVER_KEYS.CURRENT_SOURCE]: 'Source actuelle',
    [SERVER_KEYS.FAILED]: 'Sources en échec',
    [SERVER_KEYS.OVERDUE]: 'Sources en retard',
  },
  de: {
    [FEATURE_KEYS.STATE]: 'Zustand',
    [FEATURE_KEYS.LAST_SUCCESS]: 'Letzter erfolgreicher Snapshot',
    [FEATURE_KEYS.HOURS_SINCE_SUCCESS]: 'Stunden seit letztem Erfolg',
    [FEATURE_KEYS.LAST_DURATION]: 'Dauer des letzten Snapshots',
    [FEATURE_KEYS.SIZE]: 'Größe',
    [FEATURE_KEYS.FILES]: 'Dateien',
    [FEATURE_KEYS.SNAPSHOTS]: 'Snapshots',
    [FEATURE_KEYS.ERRORS]: 'Fehler des letzten Snapshots',
    [FEATURE_KEYS.RUNNING]: 'Läuft',
    [FEATURE_KEYS.NEXT_RUN]: 'Nächster geplanter Snapshot',
    [SERVER_KEYS.REPOSITORY]: 'Repository verbunden',
    [`server_${SERVER_KEYS.RUNNING}`]: 'Snapshot läuft',
    [SERVER_KEYS.PROGRESS]: 'Fortschritt',
    [SERVER_KEYS.CURRENT_SOURCE]: 'Aktuelle Quelle',
    [SERVER_KEYS.FAILED]: 'Fehlgeschlagene Quellen',
    [SERVER_KEYS.OVERDUE]: 'Überfällige Quellen',
  },
  es: {
    [FEATURE_KEYS.STATE]: 'Estado',
    [FEATURE_KEYS.LAST_SUCCESS]: 'Última instantánea correcta',
    [FEATURE_KEYS.HOURS_SINCE_SUCCESS]: 'Horas desde el último éxito',
    [FEATURE_KEYS.LAST_DURATION]: 'Duración de la última instantánea',
    [FEATURE_KEYS.SIZE]: 'Tamaño',
    [FEATURE_KEYS.FILES]: 'Archivos',
    [FEATURE_KEYS.SNAPSHOTS]: 'Instantáneas',
    [FEATURE_KEYS.ERRORS]: 'Errores de la última instantánea',
    [FEATURE_KEYS.RUNNING]: 'En ejecución',
    [FEATURE_KEYS.NEXT_RUN]: 'Próxima instantánea programada',
    [SERVER_KEYS.REPOSITORY]: 'Repositorio conectado',
    [`server_${SERVER_KEYS.RUNNING}`]: 'Instantánea en curso',
    [SERVER_KEYS.PROGRESS]: 'Progreso',
    [SERVER_KEYS.CURRENT_SOURCE]: 'Fuente actual',
    [SERVER_KEYS.FAILED]: 'Fuentes fallidas',
    [SERVER_KEYS.OVERDUE]: 'Fuentes con retraso',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_HOURS = 100_000;
export const MAX_DURATION_S = 7 * 24 * 3600;
export const MAX_SIZE_MB = 1_000_000_000;
export const MAX_COUNT = 1_000_000_000;
export const MAX_SOURCES = 10_000;

const HOUR_MS = 3_600_000;

/**
 * How long without a success makes a source overdue, in ms; null when it
 * cannot be overdue. Automatic: the period of its scheduling policy plus a
 * quarter of it (an hour at least), for a snapshot that runs late or long. A
 * source without schedule (manual, or a cron expression) is overdue only with
 * a fixed threshold.
 */
export function overdueAfterMs(source, overdueHours) {
  if (overdueHours) {
    return overdueHours * HOUR_MS;
  }
  if (!source.periodMs) {
    return null;
  }
  return source.periodMs + Math.max(HOUR_MS, source.periodMs / 4);
}

/**
 * The state of a source, by what needs attention first.
 * @returns {'running'|'failed'|'overdue'|'ok'|'never'}
 */
export function stateOf(source) {
  if (source.running) {
    return 'running';
  }
  if (source.lastRun?.result === 'error') {
    return 'failed';
  }
  if (source.overdue) {
    return 'overdue';
  }
  return source.lastSuccess !== null || source.lastRun ? 'ok' : 'never';
}

/** Whole hours since the last success, null if none. */
export const hoursSince = (source, now) =>
  source.lastSuccess === null
    ? null
    : Math.max(0, Math.floor((now - source.lastSuccess) / HOUR_MS));

export const sourceIds = (gladys, id) => gladys.externalIds(SOURCE_TYPE, id);
export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);

/** The source id of a device external id, null when it is not a source of ours. */
export function parseSourceId(gladys, externalId) {
  const prefix = sourceIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^[0-9a-f]{16}$/.test(id) ? id : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  });

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

const duration = (name, externalId, unit, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.DURATION,
    DEVICE_FEATURE_TYPES.DURATION.INTEGER,
    { unit, keep_history: true, min: 0, max },
  );

/** The discovery payload of a source. */
export function buildSourceDevice(gladys, source, language = 'en') {
  const ids = sourceIds(gladys, source.id);
  const names = NAMES[language] ?? NAMES.en;
  const name = (key) => names[key];
  return {
    name: source.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [{ name: 'SOURCE', value: source.key.slice(0, 255) }],
    features: [
      text(name(FEATURE_KEYS.STATE), ids.feature(FEATURE_KEYS.STATE)),
      text(name(FEATURE_KEYS.LAST_SUCCESS), ids.feature(FEATURE_KEYS.LAST_SUCCESS)),
      duration(
        name(FEATURE_KEYS.HOURS_SINCE_SUCCESS),
        ids.feature(FEATURE_KEYS.HOURS_SINCE_SUCCESS),
        DEVICE_FEATURE_UNITS.HOURS,
        MAX_HOURS,
      ),
      duration(
        name(FEATURE_KEYS.LAST_DURATION),
        ids.feature(FEATURE_KEYS.LAST_DURATION),
        DEVICE_FEATURE_UNITS.SECONDS,
        MAX_DURATION_S,
      ),
      sensor(
        name(FEATURE_KEYS.SIZE),
        ids.feature(FEATURE_KEYS.SIZE),
        DEVICE_FEATURE_CATEGORIES.DATA,
        DEVICE_FEATURE_TYPES.DATA.SIZE,
        { unit: DEVICE_FEATURE_UNITS.MEGABYTE, keep_history: true, min: 0, max: MAX_SIZE_MB },
      ),
      counter(name(FEATURE_KEYS.FILES), ids.feature(FEATURE_KEYS.FILES), MAX_COUNT),
      counter(name(FEATURE_KEYS.SNAPSHOTS), ids.feature(FEATURE_KEYS.SNAPSHOTS), MAX_COUNT),
      counter(name(FEATURE_KEYS.ERRORS), ids.feature(FEATURE_KEYS.ERRORS), MAX_COUNT),
      binary(name(FEATURE_KEYS.RUNNING), ids.feature(FEATURE_KEYS.RUNNING)),
      text(name(FEATURE_KEYS.NEXT_RUN), ids.feature(FEATURE_KEYS.NEXT_RUN)),
    ],
  };
}

/** The discovery payload of the server. */
export function buildServerDevice(gladys, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: 'Kopia',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: [
      binary(names[SERVER_KEYS.REPOSITORY], ids.feature(SERVER_KEYS.REPOSITORY)),
      binary(names[`server_${SERVER_KEYS.RUNNING}`], ids.feature(SERVER_KEYS.RUNNING)),
      sensor(
        names[SERVER_KEYS.PROGRESS],
        ids.feature(SERVER_KEYS.PROGRESS),
        DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
        DEVICE_FEATURE_TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
        { unit: DEVICE_FEATURE_UNITS.PERCENT, keep_history: false, min: 0, max: 100 },
      ),
      text(names[SERVER_KEYS.CURRENT_SOURCE], ids.feature(SERVER_KEYS.CURRENT_SOURCE)),
      counter(names[SERVER_KEYS.FAILED], ids.feature(SERVER_KEYS.FAILED), MAX_SOURCES),
      counter(names[SERVER_KEYS.OVERDUE], ids.feature(SERVER_KEYS.OVERDUE), MAX_SOURCES),
    ],
  };
}

const megabytes = (bytes) => Math.round((bytes / 1_000_000) * 10) / 10;

/**
 * The value of every feature of a source: `{ key, device_feature_external_id,
 * state|text }`, nothing for a value that is not known.
 */
export function sourceValues(gladys, source, language, now) {
  const ids = sourceIds(gladys, source.id);
  const values = [
    { key: FEATURE_KEYS.STATE, text: pick(STATE_TEXT[stateOf(source)], language) },
    {
      key: FEATURE_KEYS.LAST_SUCCESS,
      text: source.lastSuccess === null ? '-' : formatTime(source.lastSuccess, language),
    },
  ];
  const hours = hoursSince(source, now);
  if (hours !== null) {
    values.push({ key: FEATURE_KEYS.HOURS_SINCE_SUCCESS, state: Math.min(hours, MAX_HOURS) });
  }
  const last = source.last;
  if (last) {
    values.push({
      key: FEATURE_KEYS.LAST_DURATION,
      state: Math.min(last.durationS, MAX_DURATION_S),
    });
    if (last.sizeBytes !== null) {
      values.push({ key: FEATURE_KEYS.SIZE, state: megabytes(last.sizeBytes) });
    }
    if (last.files !== null) {
      values.push({ key: FEATURE_KEYS.FILES, state: Math.min(last.files, MAX_COUNT) });
    }
  }
  if (source.snapshots !== null) {
    values.push({ key: FEATURE_KEYS.SNAPSHOTS, state: Math.min(source.snapshots, MAX_COUNT) });
  }
  values.push(
    { key: FEATURE_KEYS.ERRORS, state: Math.min(source.lastRun?.errors ?? 0, MAX_COUNT) },
    { key: FEATURE_KEYS.RUNNING, state: source.running ? 1 : 0 },
    {
      key: FEATURE_KEYS.NEXT_RUN,
      text: source.nextRun === null ? '-' : formatTime(source.nextRun, language),
    },
  );
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

/**
 * The values of the server device. With the repository disconnected, only
 * that: the sources are not readable then.
 */
export function serverValues(gladys, { connected, sources, active }) {
  const ids = serverIds(gladys);
  const values = [{ key: SERVER_KEYS.REPOSITORY, state: connected ? 1 : 0 }];
  if (connected) {
    values.push(
      { key: SERVER_KEYS.RUNNING, state: active ? 1 : 0 },
      { key: SERVER_KEYS.PROGRESS, state: active ? (active.progress ?? 0) : 0 },
      { key: SERVER_KEYS.CURRENT_SOURCE, text: active ? active.name : '-' },
      // The last snapshot, not the state: a failed source running again still counts.
      {
        key: SERVER_KEYS.FAILED,
        state: sources.filter((source) => source.lastRun?.result === 'error').length,
      },
      {
        key: SERVER_KEYS.OVERDUE,
        state: sources.filter((source) => source.overdue).length,
      },
    );
  }
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}
