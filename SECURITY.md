# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **username and password of the Kopia server** (`--server-username`,
  `--server-password`), stored by Gladys in the integration configuration
  (never written to `/data`, never logged); they are only sent, as Basic
  credentials, to the address configured, and redirects are not followed so
  they never reach another host. The password of the repository is never
  asked;
- the **session cookie and CSRF token** of the Kopia web interface: kept in
  memory only, asked again when Kopia restarts;
- an optional **certificate fingerprint** (SHA-256): a self-signed certificate
  is accepted only when it matches, before any credential is sent;
- `/data/kopia-state.json`: the address of the server, and for each source
  (a hash of its identity) its last snapshot seen, its last success and whether
  it was overdue (no secret, no path);
- network: HTTP(S) requests to the Kopia address, nothing else; no port is
  opened. The integration can start a snapshot (when allowed in its
  configuration), never delete, restore or edit one.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Kopia itself.
