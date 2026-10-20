# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The sources of a Kopia server (`kopia server start`) in Gladys: one device per
  source (state, last successful snapshot, hours since then, last snapshot
  duration, size, files, snapshots kept, errors of the last snapshot, running,
  next scheduled snapshot) and one server device (repository connected,
  snapshot running, progress, current source, sources failed and overdue).
- Scene triggers: a snapshot succeeds, a snapshot fails (files unreadable,
  incomplete, or a complete failure), a source is overdue (automatic delay from
  its scheduling policy, or a fixed one) — for any source, added to Gladys or
  not, kept across restarts.
- Scene actions: state of a source (with a ready-made sentence), start a
  snapshot (can be disabled in the configuration).
- Dashboard widget: failed sources first, then the overdue ones, then the
  others, with a Refresh button.
- HTTP, HTTPS, and self-signed HTTPS pinned by its SHA-256 fingerprint.
- "Test the connection"; texts and documentation in English, French, German
  and Spanish.
