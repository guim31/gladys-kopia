// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Kopia, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Duplicati with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-duplicati.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { sourceIds } from '../../src/devices.js';
import { sourceId } from '../../src/kopia/client.js';
import { Store } from '../../src/store.js';
import { BASE, FakeKopia, LOCAL, PASSWORD, USERNAME } from './fakeKopia.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HOUR = 3_600_000;
export const START = Date.UTC(2026, 9, 19, 10, 0, 0);

/** A manual clock, shared by the hub, the fake and the tests. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * The default server: a daily source snapshotted 8 hours ago, a daily source
 * whose last snapshot could not read a file 2 hours ago (last success 26
 * hours ago), a manual one never snapshotted.
 */
export function defaultKopia(now = START) {
  const fake = new FakeKopia();
  fake.add('/home/anna', { next: now + 16 * HOUR });
  fake.snapshot('/home/anna', 'success', { end: now - 32 * HOUR });
  fake.snapshot('/home/anna', 'success', { end: now - 8 * HOUR, seconds: 420 });
  fake.add('/srv/photos', { next: now + 16 * HOUR });
  fake.snapshot('/srv/photos', 'success', { end: now - 26 * HOUR });
  fake.snapshot('/srv/photos', 'error', { end: now - 2 * HOUR });
  fake.add('/etc', { schedule: { manual: true } });
  return fake;
}

export async function createWorld({
  clock = createClock(),
  kopia = defaultKopia(clock.time),
  config = { url: BASE, username: USERNAME, password: PASSWORD, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-kopia-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: kopia.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, kopia, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a source of the fake, by path. */
export const idsOf = (world, path) =>
  sourceIds(world.gladys, sourceId(world.kopia.get(path).source));

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { BASE, FakeKopia, LOCAL, PASSWORD, USERNAME };
