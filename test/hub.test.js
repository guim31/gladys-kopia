// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Kopia: discovery, states,
// scene events on snapshots and overdue sources, persistence across restarts,
// a snapshot running, the start action, errors, quiet logs, the widget and
// the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, SERVER_KEYS, overdueAfterMs, serverIds } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  BASE,
  FakeKopia,
  HOUR,
  LOCAL,
  PASSWORD,
  START,
  USERNAME,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const state = (world, path, key) => world.fake.lastState(idsOf(world, path).feature(key));
const server = (world, key) => world.fake.lastState(serverIds(world.gladys).feature(key));
const config = (extra = {}) => ({
  url: BASE,
  username: USERNAME,
  password: PASSWORD,
  language: 'en',
  ...extra,
});

test('one device per source and one for the server, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Kopia', '/home/anna', '/srv/photos', '/etc'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  // Nothing is published for devices not added, and the first read fires nothing.
  assert.equal(world.fake.states.length, 0);
  assert.equal(world.fake.sceneEvents.length, 0);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('a source of another host or user is named with it', async (t) => {
  const kopia = new FakeKopia();
  kopia.add('/home/anna');
  kopia.add('/home/anna', { owner: { userName: 'bob', host: 'laptop' } });
  const world = await createWorld({ kopia });
  t.after(() => world.app.stop());
  // Two sources of the same path: the second replaces the first in the fake,
  // the name tells the owner.
  assert.deepEqual(
    world.fake.discoveredDevices.map((d) => d.name),
    ['Kopia', 'bob@laptop:/home/anna'],
  );
});

test('the states of the added devices: success, files unreadable, never snapshotted', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.STATE), 'OK');
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.HOURS_SINCE_SUCCESS), 8);
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.LAST_DURATION), 420);
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.SNAPSHOTS), 2);
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.SIZE), 1234.6);
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.FILES), 120);
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.ERRORS), 0);
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.RUNNING), 0);
  assert.notEqual(state(world, '/home/anna', FEATURE_KEYS.NEXT_RUN), '-');

  assert.equal(state(world, '/srv/photos', FEATURE_KEYS.STATE), 'Failed');
  assert.equal(state(world, '/srv/photos', FEATURE_KEYS.ERRORS), 1);
  // The last success is the snapshot before the one with errors.
  assert.equal(state(world, '/srv/photos', FEATURE_KEYS.HOURS_SINCE_SUCCESS), 26);

  assert.equal(state(world, '/etc', FEATURE_KEYS.STATE), 'No snapshot');
  assert.equal(state(world, '/etc', FEATURE_KEYS.LAST_SUCCESS), '-');
  assert.equal(state(world, '/etc', FEATURE_KEYS.NEXT_RUN), '-');
  assert.equal(state(world, '/etc', FEATURE_KEYS.HOURS_SINCE_SUCCESS), undefined);

  assert.equal(server(world, SERVER_KEYS.REPOSITORY), 1);
  assert.equal(server(world, SERVER_KEYS.FAILED), 1);
  assert.equal(server(world, SERVER_KEYS.RUNNING), 0);
  assert.equal(server(world, SERVER_KEYS.CURRENT_SOURCE), '-');
});

test('a new snapshot fires "succeeded" or "failed", once; a complete failure too', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const { kopia, clock } = world;

  clock.advance(HOUR);
  kopia.snapshot('/home/anna', 'success', { end: clock.time, seconds: 600, files: 130 });
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.SUCCEEDED).at(-1).data, {
    device: idsOf(world, '/home/anna').device,
    source: '/home/anna',
    duration_minutes: 10,
    files: 130,
    size: '1.2 GB',
    snapshots: 3,
  });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SUCCEEDED).length, 1, 'not twice');

  clock.advance(HOUR);
  kopia.snapshot('/home/anna', 'error', { end: clock.time, errors: 2 });
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.FAILED).at(-1).data, {
    device: idsOf(world, '/home/anna').device,
    source: '/home/anna',
    message: 'secret.txt: unable to open file: permission denied',
    errors: 2,
  });

  clock.advance(HOUR);
  kopia.snapshot('/home/anna', 'failed', { end: clock.time });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FAILED).length, 2);
  assert.match(events(world, TRIGGERS.FAILED).at(-1).data.message, /no such file/);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FAILED).length, 2, 'not twice');
  // The last success is still the one two hours ago.
  assert.equal(
    world.hub.find(idsOf(world, '/home/anna').device).lastSuccess,
    clock.time - 2 * HOUR,
  );
});

test('Kopia restarted: the task of a failure is lost, the snapshot before it is no news', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.clock.advance(HOUR);
  world.kopia.snapshot('/home/anna', 'failed', { end: world.clock.time });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FAILED).length, 1);
  const pages = world.kopia.pages;
  world.kopia.restart();
  await world.hub.pollNow();
  assert.equal(world.kopia.pages, pages + 1, 'a new session');
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(events(world, TRIGGERS.SUCCEEDED).length, 0);
  assert.equal(events(world, TRIGGERS.FAILED).length, 1);
});

test('a source becomes overdue once, by its schedule, and back when it succeeds', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const { kopia, clock } = world;
  // /home/anna: daily, last success 8 hours ago; overdue after 24 + 6 hours.
  clock.advance(21 * HOUR);
  await world.hub.pollNow();
  const anna = () =>
    events(world, TRIGGERS.OVERDUE).filter((event) => event.data.source === '/home/anna');
  assert.equal(anna().length, 0);
  clock.advance(2 * HOUR);
  await world.hub.pollNow();
  assert.equal(anna().length, 1);
  assert.equal(anna()[0].data.hours_since_success, 31);
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.STATE), 'Overdue');
  // /srv/photos is overdue too, but failed: its state says "Failed".
  assert.equal(state(world, '/srv/photos', FEATURE_KEYS.STATE), 'Failed');
  assert.equal(server(world, SERVER_KEYS.OVERDUE), 2);

  await world.hub.pollNow();
  assert.equal(anna().length, 1, 'not twice');
  kopia.snapshot('/home/anna', 'success', { end: clock.time });
  await world.hub.pollNow();
  assert.equal(state(world, '/home/anna', FEATURE_KEYS.STATE), 'OK');
});

test('the overdue threshold: automatic from the interval, none without, or fixed', () => {
  assert.equal(overdueAfterMs({ periodMs: 24 * HOUR }, null), 30 * HOUR);
  assert.equal(overdueAfterMs({ periodMs: HOUR }, null), 2 * HOUR);
  assert.equal(overdueAfterMs({ periodMs: null }, null), null);
  assert.equal(overdueAfterMs({ periodMs: null }, 48), 48 * HOUR);
  assert.equal(overdueAfterMs({ periodMs: HOUR }, 12), 12 * HOUR);
});

test('the last success stays known when retention deletes it', async (t) => {
  const world = await createWorld({ timings: { historyEveryMs: 0 } });
  t.after(() => world.app.stop());
  const before = world.hub.find(idsOf(world, '/srv/photos').device).lastSuccess;
  world.clock.advance(HOUR);
  const photos = world.kopia.get('/srv/photos');
  photos.snapshots = photos.snapshots.slice(-1); // the success is gone
  await world.hub.pollNow();
  assert.equal(world.hub.find(idsOf(world, '/srv/photos').device).lastSuccess, before);
});

test('a snapshot made while the integration was stopped is announced after a restart, once', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  await first.app.stop();
  clock.advance(HOUR);
  first.kopia.snapshot('/home/anna', 'error', { end: clock.time });
  const second = await createWorld({ clock, kopia: first.kopia, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(events(second, TRIGGERS.FAILED).length, 1);
  await second.app.stop();
  const third = await createWorld({ clock, kopia: first.kopia, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(events(third, TRIGGERS.FAILED).length, 0);
});

test('a snapshot running: the server shows it and its progress; then its end', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const { kopia, clock } = world;
  kopia.run('/etc', 30);
  await world.hub.pollNow();
  assert.equal(server(world, SERVER_KEYS.RUNNING), 1);
  assert.equal(server(world, SERVER_KEYS.PROGRESS), 30);
  assert.equal(server(world, SERVER_KEYS.CURRENT_SOURCE), '/etc');
  assert.equal(state(world, '/etc', FEATURE_KEYS.RUNNING), 1);
  assert.equal(state(world, '/etc', FEATURE_KEYS.STATE), 'Running');

  // While it runs, the snapshot lists are not read again.
  const lists = () => kopia.requests.filter((r) => r.path.startsWith('/api/v1/snapshots')).length;
  const before = lists();
  await world.hub.pollNow();
  assert.equal(lists(), before);

  clock.advance(10 * 60_000);
  kopia.idle('/etc');
  kopia.snapshot('/etc', 'success', { end: clock.time });
  await world.hub.pollNow();
  assert.equal(server(world, SERVER_KEYS.RUNNING), 0);
  assert.equal(server(world, SERVER_KEYS.PROGRESS), 0);
  assert.equal(state(world, '/etc', FEATURE_KEYS.STATE), 'OK');
  assert.equal(events(world, TRIGGERS.SUCCEEDED).at(-1).data.source, '/etc');
});

test('"Start a snapshot" starts it in Kopia, unless disabled in the configuration', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = idsOf(world, '/etc').device;
  const ack = await world.fake.sceneAction('start_backup', { device });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.kopia.started, ['/etc']);
  const upload = world.kopia.requests.find((r) => r.method === 'POST');
  assert.equal(
    upload.path,
    `/api/v1/sources/upload?userName=${LOCAL.userName}&host=${LOCAL.host}&path=%2Fetc`,
  );

  await world.fake.configUpdated(config({ language: 'fr', allow_start: false }));
  const refused = await world.fake.sceneAction('start_backup', { device });
  assert.equal(refused.success, false);
  assert.match(refused.error, /désactivé/);
  assert.equal(world.kopia.started.length, 1);

  const unknown = await world.fake.sceneAction('get_backup_status', { device: 'nope' });
  assert.equal(unknown.success, false);
});

test('"State of a source" gives a sentence in the language of the configuration', async (t) => {
  const world = await createWorld({ config: config({ language: 'fr' }) });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, '/srv/photos').device,
  });
  assert.equal(ack.success, true, ack.error);
  const outputs = ack.data.outputs;
  assert.equal(outputs.failed, true);
  assert.equal(outputs.state, 'En échec');
  assert.equal(outputs.hours_since_success, 26);
  assert.match(
    outputs.sentence,
    /^\/srv\/photos : En échec, dernière réussite \d\d\/10 \d\d:\d\d\.$/,
  );
  const never = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, '/etc').device,
  });
  assert.equal(never.data.outputs.hours_since_success, -1);
  assert.match(never.data.outputs.sentence, /jamais réussie/);
});

test('Kopia down, wrong password, no repository, no configuration: a status, the badge, no crash', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.kopia.failure = 'down';
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  assert.ok(
    world.fake.transports.some((entry) => entry.transport === 'unreachable'),
    'unreachable badge',
  );
  const action = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, '/etc').device,
  });
  assert.equal(action.success, false);
  world.kopia.failure = null;
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);

  world.kopia.connected = false;
  await world.hub.pollNow();
  assert.match(world.fake.connectionStatus.message.en, /not connected to its repository/);
  assert.equal(server(world, SERVER_KEYS.REPOSITORY), 0);
  world.kopia.connected = true;
  await world.hub.pollNow();
  assert.equal(server(world, SERVER_KEYS.REPOSITORY), 1);

  await world.fake.configUpdated(config({ password: 'wrong' }));
  assert.match(world.fake.connectionStatus.message.en, /password refused/);
  await world.fake.configUpdated(config({ fingerprint: 'not one' }));
  assert.match(world.fake.connectionStatus.message.en, /fingerprint not understood/);
  await world.fake.configUpdated({ url: '', password: '', language: 'en' });
  assert.match(world.fake.connectionStatus.message.en, /address of your Kopia/);
  const report = await world.fake.action('test_connection', {});
  assert.equal(report.success, true);
});

test('another server forgets what was seen of the previous one', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated(config({ url: 'http://192.0.2.11:51515' }));
  assert.equal(Object.keys(world.hub.saved.sources).length, 3);
  assert.equal(world.hub.saved.url, 'http://192.0.2.11:51515');
  assert.equal(world.fake.sceneEvents.length, 0);
});

test('"Test the connection" sums up the server', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  const message = ack.data?.message ?? ack.data;
  assert.equal(message.en, 'Kopia: Connected, 3 source(s), 1 failed');
  assert.equal(message.fr, 'Kopia : Connecté, 3 source(s), 1 en échec');
});

test('the widget: valid content, failed first, then the others', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
    assert.equal(ack.success, true, ack.error);
    const content = ack.data.content;
    assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
    const status = content.components.find((c) => c.type === 'status');
    assert.deepEqual(
      status.items.map((item) => item.label),
      ['/srv/photos', '/etc', '/home/anna'],
    );
  }
  const chosen = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { sources: [idsOf(world, '/etc').device] },
    language: 'en',
  });
  const rows = chosen.data.content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((item) => item.label),
    ['/etc'],
  );
  const action = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { language: 'en' });
  assert.equal(action.success, true, action.error);
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('a normal reading cycle writes nothing at the info level, nor the password', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      world.clock.advance(5 * 60_000);
      await world.hub.pollNow();
    }
  });
  assert.ok(world.fake.states.length >= sent);
  assert.ok(!lines.join('\n').includes(PASSWORD));
  assert.deepEqual(lines, []);
});

test('the internal timer reads Kopia, every 30 seconds while a snapshot runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const kopia = new FakeKopia();
  kopia.add('/home/anna');
  kopia.snapshot('/home/anna', 'success', { end: START - HOUR });
  kopia.run('/home/anna');
  const world = await createWorld({ kopia, timers: true });
  t.after(() => world.app.stop());
  const reads = () => kopia.requests.filter((r) => r.path === '/api/v1/sources').length;
  const before = reads();
  t.mock.timers.tick(30_000);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(reads(), before + 1);
});
