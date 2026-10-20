// -----------------------------------------------------------------------------
// The Kopia client against the real answers of a Kopia 0.23.1
// (test/fixtures/kopia, recorded from the kopia/kopia image: a filesystem
// repository, a source snapshotted, one with a file it could not read, one
// whose path was deleted — a FAILED task without snapshot), and its session,
// CSRF token and errors against the fake.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ERROR_KINDS,
  KopiaClient,
  failedSnapshots,
  historyOf,
  normalizeFingerprint,
  normalizeSnapshot,
  normalizeSources,
  periodOf,
  progressOf,
  sourceId,
} from '../src/kopia/client.js';
import { normalizeConfig, parseServerUrl } from '../src/config.js';
import { BASE, FakeKopia, LOCAL, PASSWORD, USERNAME } from './helpers/fakeKopia.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/kopia/${name}`, import.meta.url), 'utf8'));

test('the sources of a real Kopia, normalized', async () => {
  const sources = normalizeSources(await fixture('sources.json'));
  assert.deepEqual(
    sources.map((s) => [s.name, s.status, s.running, s.periodMs, s.last?.result]),
    [
      ['/tmp/src/docs', 'IDLE', false, 86_400_000, 'success'],
      ['/tmp/src/gone', 'IDLE', false, null, 'success'],
      ['/tmp/src/locked', 'IDLE', false, null, 'error'],
    ],
  );
  const [docs, , locked] = sources;
  assert.equal(docs.key, 'nobody@nas:/tmp/src/docs');
  assert.match(docs.id, /^[0-9a-f]{16}$/);
  assert.equal(docs.id, sourceId({ userName: 'nobody', host: 'nas', path: '/tmp/src/docs' }));
  assert.equal(docs.nextRun, Date.parse('2026-10-21T00:00:00Z'));
  assert.deepEqual(
    { ...docs.last, begin: undefined, end: undefined },
    {
      id: '9f56b12959dcc346bb02e4b7381aa3e8',
      result: 'success',
      begin: undefined,
      end: undefined,
      durationS: 0,
      sizeBytes: 12,
      files: 2,
      errors: 0,
      incomplete: false,
      checkpoint: false,
      message: '',
    },
  );
  assert.equal(locked.last.errors, 1);
  assert.match(locked.last.message, /^nope\.txt: unable to open file: .*permission denied$/);
});

test('a snapshot of unchanged files in a real Kopia: the files of the tree, not the ones read', async () => {
  const [docs] = normalizeSources(await fixture('sources-unchanged.json'));
  assert.equal(docs.last.files, 2);
  assert.equal(docs.last.sizeBytes, 12);
});

test('a snapshot running in a real Kopia: its progress', async () => {
  const sources = normalizeSources(await fixture('sources-running.json'));
  const running = sources.find((s) => s.running);
  assert.equal(running.name, '/tmp/src/locked');
  assert.equal(running.status, 'UPLOADING');
  assert.equal(running.progress, 50);
  assert.equal(running.last, null);
});

test('the tasks of a real Kopia: the complete failure of a snapshot', async () => {
  const failures = failedSnapshots(await fixture('tasks.json'));
  assert.deepEqual([...failures.keys()], ['nobody@nas:/tmp/src/gone']);
  const gone = failures.get('nobody@nas:/tmp/src/gone');
  assert.equal(gone.begin, Date.parse('2026-10-20T06:52:30.319581105Z'));
  assert.match(gone.message, /no such file or directory/);
});

test('the snapshot list of a real Kopia: count and last success', async () => {
  const docs = historyOf(await fixture('snapshots-docs.json'));
  assert.equal(docs.count, 1);
  assert.equal(docs.lastSuccess, Date.parse('2026-10-20T06:52:10.968722945Z'));
  const locked = historyOf(await fixture('snapshots-locked.json'));
  assert.deepEqual(locked, { count: 1, lastSuccess: null });
});

test('a real repository status, connected or not', async () => {
  assert.equal((await fixture('repo-status.json')).connected, true);
  assert.equal((await fixture('repo-disconnected.json')).connected, false);
});

test('snapshots incomplete, schedules, progress', () => {
  const incomplete = normalizeSnapshot({
    startTime: '2026-10-20T06:00:00Z',
    endTime: '2026-10-20T06:10:00Z',
    incomplete: 'canceled',
    stats: { errorCount: 0 },
  });
  assert.equal(incomplete.result, 'error');
  assert.equal(incomplete.durationS, 600);
  assert.equal(normalizeSnapshot({ startTime: '0001-01-01T00:00:00Z' }), null);
  assert.equal(periodOf({ intervalSeconds: 3600 }), 3_600_000);
  assert.equal(periodOf({ timeOfDay: [{ hour: 2, min: 0 }] }), 86_400_000);
  assert.equal(periodOf({ cron: ['0 2 * * *'] }), null);
  assert.equal(periodOf({ intervalSeconds: 3600, manual: true }), null);
  assert.equal(progressOf({ hashedBytes: 30, cachedBytes: 20, estimatedBytes: 100 }), 50);
  assert.equal(progressOf({ hashedBytes: 300, estimatedBytes: 100 }), 99);
  assert.equal(progressOf({ hashedBytes: 0, estimatedBytes: 0 }), null);
});

test('the address, the username and the fingerprint typed by the user', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10:51515');
  assert.equal(parseServerUrl('nas.local:8443'), 'http://nas.local:8443');
  assert.equal(parseServerUrl('https://192.0.2.10:51515/snapshots'), 'https://192.0.2.10:51515');
  assert.equal(
    parseServerUrl('https://backup.example.org/kopia/repo'),
    'https://backup.example.org/kopia',
  );
  assert.equal(parseServerUrl('http://user:pass@192.0.2.10'), null);
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);

  const hex = 'ab'.repeat(32);
  assert.equal(normalizeFingerprint(hex.toUpperCase()), hex);
  assert.equal(normalizeFingerprint(hex.match(/../g).join(':')), hex);
  assert.equal(normalizeFingerprint(`SHA256: ${hex}`), hex);
  assert.equal(normalizeFingerprint('abcd'), null);

  assert.equal(
    normalizeConfig({ url: '192.0.2.10', fingerprint: hex }).url,
    'https://192.0.2.10:51515',
  );
  assert.equal(
    normalizeConfig({ url: 'http://192.0.2.10:51515', fingerprint: hex }).url,
    'https://192.0.2.10:51515',
  );
  const config = normalizeConfig({ url: '192.0.2.10', password: ' p ', username: '  ' });
  assert.equal(config.username, 'kopia');
  assert.equal(config.password, ' p ');
  assert.equal(config.fingerprint, null);
  assert.equal(config.fingerprintTyped, false);
});

test('opens a session once, again when Kopia forgets it', async () => {
  const fake = new FakeKopia();
  fake.add('/home/anna');
  const client = new KopiaClient({
    url: BASE,
    username: USERNAME,
    password: PASSWORD,
    request: fake.request,
  });
  await client.repository();
  await client.sources();
  assert.equal(fake.pages, 1);
  fake.restart(); // its sessions are lost
  assert.equal((await client.sources()).length, 1);
  assert.equal(fake.pages, 2);
  const call = fake.requests.at(-1);
  assert.equal(call.headers['x-kopia-csrf-token'], 'csrf-2');
  assert.equal(call.headers.cookie, 'Kopia-Session-Cookie=s2');
});

test('starts a snapshot of a source', async () => {
  const fake = new FakeKopia();
  fake.add('/home/anna dir');
  const client = new KopiaClient({
    url: BASE,
    username: USERNAME,
    password: PASSWORD,
    request: fake.request,
  });
  await client.snapshot({ ...LOCAL, path: '/home/anna dir' });
  assert.deepEqual(fake.started, ['/home/anna dir']);
});

test('the errors, by kind, without the password in the message', async () => {
  const fake = new FakeKopia();
  fake.add('/home/anna');
  const kind = async (client, call = (c) => c.sources()) => {
    try {
      await call(client);
    } catch (err) {
      assert.ok(!err.message.includes(PASSWORD));
      return err.kind;
    }
    return null;
  };
  const make = (options = {}) =>
    new KopiaClient({
      url: BASE,
      username: USERNAME,
      password: PASSWORD,
      request: fake.request,
      ...options,
    });
  assert.equal(await kind(make({ password: 'wrong' })), ERROR_KINDS.AUTH);
  assert.equal(await kind(make({ username: 'admin' })), ERROR_KINDS.AUTH);
  fake.failure = 'down';
  assert.equal(await kind(make()), ERROR_KINDS.UNREACHABLE);
  fake.failure = 302;
  assert.equal(await kind(make()), ERROR_KINDS.REDIRECT);
  fake.failure = 404;
  assert.equal(await kind(make()), ERROR_KINDS.NOT_KOPIA);
  fake.failure = 500;
  assert.equal(await kind(make()), ERROR_KINDS.HTTP);
  fake.failure = null;
  fake.connected = false;
  assert.equal(await kind(make()), ERROR_KINDS.NO_REPOSITORY);
  fake.connected = true;
  assert.equal(
    await kind(make(), (c) => c.snapshot({ ...LOCAL, path: '/nope' })),
    ERROR_KINDS.NOT_FOUND,
  );
  const refused = (code) => async () => {
    throw Object.assign(new Error('boom'), { code });
  };
  assert.equal(
    await kind(make({ request: refused('DEPTH_ZERO_SELF_SIGNED_CERT') })),
    ERROR_KINDS.TLS,
  );
  assert.equal(
    await kind(make({ request: refused('FINGERPRINT_MISMATCH') })),
    ERROR_KINDS.FINGERPRINT,
  );
  const html = async () => ({ status: 200, headers: {}, body: '<html>Router</html>' });
  assert.equal(await kind(make({ request: html })), ERROR_KINDS.NOT_KOPIA);
});
