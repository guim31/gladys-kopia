# Kopia for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the sources of a [Kopia](https://kopia.io/) server
(`kopia server start`) into Gladys: the state of their snapshots, and an alert
when a snapshot fails or stops running.

- **One device per source** (a folder backed up): state (OK, failed, overdue,
  running, no snapshot), last successful snapshot, hours since then, duration,
  size and files of the last snapshot, snapshots kept, errors of the last
  snapshot, running, next scheduled snapshot.
- **One server device**: repository connected, a snapshot running, its
  progress and source, the number of sources failed and overdue.
- **Scene triggers**: a snapshot succeeds, a snapshot fails (files unreadable,
  incomplete, or a complete failure), a source is overdue (no success for
  longer than its scheduling interval, or a fixed delay) — for any source,
  added to Gladys or not. Same triggers and actions as
  [gladys-duplicati](https://github.com/guim31/gladys-duplicati).
- **Scene actions**: state of a source (with a ready-made sentence), start a
  snapshot (can be disabled in the configuration).
- **Dashboard widget**: failed sources first, then the overdue ones, then the
  others.
- HTTP, HTTPS, or the self-signed certificate of `--tls-generate-cert`, pinned
  by its SHA-256 fingerprint.
- Texts in English, French, German and Spanish.

Tested against a real Kopia 0.23 (Docker image `kopia/kopia`, filesystem
repository, Basic authentication, HTTP and self-signed HTTPS): a snapshot
succeeded, one with a file it could not read, one whose folder was deleted,
and a snapshot started from the integration. Not yet tested on a real Gladys:
feedback welcome on [the issues](https://github.com/guim31/gladys-kopia/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- Kopia running as a server with its web interface (`kopia server start`),
  reachable from the Gladys machine (port 51515 by default), with its
  `--server-username` and `--server-password`. KopiaUI alone (the desktop
  application) only listens to its own computer.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-kopia`. Then open its configuration, enter
the address of the Kopia server, its username and password (and the
fingerprint of a self-signed certificate), and add the sources from the
Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container opens a session on the web interface of Kopia (Basic
credentials, then the session cookie and the CSRF token of its page, as the
interface does) and reads the repository status, the sources, the task list
and, when a source has a new snapshot, its snapshot list, every 5 minutes by
default and every 30 seconds while a snapshot runs. It publishes the states of
the devices added to Gladys when they change, and fires the scene events on
the new snapshots and on the sources turning overdue. The last snapshot seen
of each source is kept in `/data`, so a snapshot that failed during a restart
is announced once. Redirects are not followed, so the credentials are never
sent to another host.

## Limits

- One Kopia server per configuration.
- A complete failure (no snapshot saved: a folder deleted, a storage
  unreachable) only shows in the task list of the Kopia server, which it keeps
  in memory: it is announced when it happens, and forgotten after Kopia
  restarts.
- The integration watches and starts snapshots; it does not restore, delete or
  edit snapshots or policies.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the Kopia
API.

## Credits

- [Kopia](https://github.com/kopia/kopia) by its contributors (Apache-2.0):
  the API answers in `test/fixtures/kopia` come from its Docker image. The logo
  on the cover is the Kopia logo, from its repository.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-duplicati](https://github.com/guim31/gladys-duplicati).

Not affiliated with Kopia or its authors.
