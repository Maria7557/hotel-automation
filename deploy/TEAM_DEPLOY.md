# Ospio deployment for a team

## The scheme

**Each of the 2–3 developers uses their own GitHub account. Deployment credentials
belong to GitHub Actions, not to a developer or their laptop.**

```mermaid
flowchart LR
  A["Developer 1 / 2 / 3<br/>Individual GitHub login"] --> B["GitHub Actions<br/>main + operation=deploy"]
  B --> C["Environment: ospio-hotel-production<br/>One CI service credential"]
  C --> D["ospio-hotel-deploy@ospio.online<br/>Restricted receiver"]
  D --> E["Frontend + API + contact worker<br/>Backup, migration checks, health checks"]
```

The CI credential is **already configured and successfully authenticates**.
Start with the existing-key installer below. **No developer sends Maria a
laptop SSH key. No developer needs SSH for an ordinary release.**

## Maria TODO 1 — GitHub accounts and environment

Repository: **https://github.com/Maria7557/hotel-automation**

1. **Settings → Collaborators → Add people**: keep `Maria7557` as owner;
   `KseniaKuntsevich` already has **Write**. Add the third developer's own
   GitHub username with **Write**, then have them accept the invitation.
2. **Settings → Environments → ospio-hotel-production**: allow deployments
   only from the exact **main** branch.
3. Do not require Maria's approval on every environment deployment. Every
   developer with Write access must be able to dispatch the workflow.
4. Keep main protected and retain code-owner review of infrastructure,
   workflow and migration changes. Add a third maintainer's username to
   `.github/CODEOWNERS` if they should review those changes too.
5. Review and merge the PR containing this installer/runbook before TODO 3.
   Do not turn off branch protection to merge it.

These are individual accounts. Do not share Maria's login, token or password.

## Maria TODO 2 — confirm these exact GitHub values

Open **Settings → Environments → ospio-hotel-production**.

| Exact name | Placement | Exact value shape |
| --- | --- | --- |
| `OSPIO_HOTEL_DEPLOY_KEY` | **Environment secret** | Full multiline, unencrypted OpenSSH **private service key**, including BEGIN and END lines. Already configured. |
| `OSPIO_HOTEL_KNOWN_HOSTS` | **Environment secret** | Actual server known_hosts line: `ospio.online ssh-ed25519 AAAAC3...`. Already configured. |
| `OSPIO_HOTEL_DEPLOY_READY` | **Environment variable** | Text `true`. Already configured. |

Private-key secret shape (the example is not a real key):

```text
-----BEGIN OPENSSH PRIVATE KEY-----
<base64 lines from the dedicated CI service key>
-----END OPENSSH PRIVATE KEY-----
```

Paste file **contents**, not a path, public key, JSON object or quoted string.
The private key stays in the GitHub environment. A runner creates a temporary
0600 file for its job and removes it when the job exits.

The matching **public** key is a single line:

```text
ssh-ed25519 AAAAC3... ospio-github-actions
```

It belongs in the server service account's `.ssh/authorized_keys`, with the
forced-command restriction installed below. It is not the private-key secret.
Developers do not receive either a personal server account or the CI private key.

Optional public frontend build settings belong at **repository Settings →
Secrets and variables → Actions → Variables**:

- `OSPIO_WEB_GOOGLE_WEB_CLIENT_ID`
- `OSPIO_WEB_SUPPORT_PHONE`
- `OSPIO_WEB_SUPPORT_EMAIL`
- `OSPIO_WEB_SUPPORT_WHATSAPP`
- `OSPIO_WEB_SUPPORT_TELEGRAM`

Backend credentials remain in `/etc/hotel-automation/server.env`. Do not put
that file or its credentials into public frontend variables.
Optional Signal configuration follows [monitoring.md](../docs/monitoring.md).

## Maria TODO 3 — one-time server installation, using the existing CI key

Correct target: **server1.paddock.ae / 199.192.27.68 / ospio.online**.

Use Maria's **existing administrator session on that server**. Enter `sudo -i`
separately if necessary. No password reset, developer-laptop key, VPS reboot or
change to the other hosted application is needed.

Check the machine first:

```sh
hostname -f
ip -4 address
```

After TODO 1's PR is merged, paste this block **inside the server's root shell**.
It downloads the exact main commit to a separate root-only setup directory:

```bash
set -euo pipefail
OSPIO_SETUP_COMMIT="$(curl --fail --silent --show-error https://api.github.com/repos/Maria7557/hotel-automation/git/ref/heads/main | python3 -c 'import json,sys; print(json.load(sys.stdin)["object"]["sha"])')"
OSPIO_SETUP_DIR="$(mktemp -d /root/ospio-deploy-setup.XXXXXX)"
curl --fail --silent --show-error --location "https://codeload.github.com/Maria7557/hotel-automation/tar.gz/$OSPIO_SETUP_COMMIT" --output "$OSPIO_SETUP_DIR/source.tar.gz"
tar --extract --gzip --file "$OSPIO_SETUP_DIR/source.tar.gz" --directory "$OSPIO_SETUP_DIR" --strip-components=1
python3 "$OSPIO_SETUP_DIR/deploy/install_ospio_deploy.py" --commit "$OSPIO_SETUP_COMMIT" --reuse-existing-key --enable-production
```

Expected output includes JSON with `"production_enabled": true`, the installed
commit, live commit and both service states. Save that non-secret output.

### Exact server placement

| Path | Owner / mode | Purpose |
| --- | --- | --- |
| `/usr/local/libexec/ospio-hotel-receive` | root / 0755 | Forced SSH command; only status, stage, verified release. |
| `/usr/local/libexec/ospio-hotel/ospio_live.py` | root / 0755 | Verified FE + BE release and database backup/migration checks. |
| `/usr/local/libexec/ospio-hotel/ospio_status.py` | root / 0755 | Read-only JSON readiness and live-release check. |
| `/usr/local/libexec/ospio-hotel/ospio_stage.py` | root / 0755 | Isolated staging as the deployment account. |
| `/usr/local/libexec/ospio-hotel/ospio_release.py` | root / 0644 | Archive validation and paired rollback. |
| `/usr/local/libexec/ospio-hotel/installed.json` | root / 0644 | Installed commit and script checksums. |
| `/etc/sudoers.d/ospio-hotel-deploy` | root / 0440 | Only live/status helper commands, with no arguments. No general sudo. |
| `/etc/ospio-hotel-deploy.enabled` | root / 0600 | Permanent release authorization; survives releases and reboots. |
| `/opt/hotel-automation/.npm` | hotelapp / 0700 when created | Runtime dependency cache, tested writable by the app account. |
| `/var/lib/ospio-hotel-deploy/runner` | root / 0700 | Release preparation, locks, DB/config backups. |
| `/var/lib/ospio-hotel-deploy/staged` | deployment account / 0700 | Candidate uploads, separate from production. |
| `/var/lib/ospio-hotel-deploy/setup-backups` | root / 0700 | Previous receiver/config versions retained during setup upgrades. |

The service account is exactly `ospio-hotel-deploy`. Its existing home is
preserved; a fresh installation uses `/home/ospio-hotel-deploy`. Display the
actual home with `getent passwd ospio-hotel-deploy | cut -d: -f6`. Its public
authorization file is `<that-home>/.ssh/authorized_keys`, root-owned, mode 0644.
The home and `.ssh` directory are root-owned/non-writable by the service account.
Each key is normalized to:

```text
restrict,command="/usr/local/libexec/ospio-hotel-receive" ssh-ed25519 AAAAC3... ospio-github-actions
```

The installer reuses existing public key material. It never reads or copies a
private key. It leaves nginx, server passwords, uploads and the running app alone.

## Maria TODO 4 — prove every teammate can release

For **each developer, signed into their own GitHub account on any computer**:

1. Open [Actions → Deploy Ospio Hotel](https://github.com/Maria7557/hotel-automation/actions/workflows/ospio-hotel-deploy.yml).
2. **Run workflow → main → operation=status → Run workflow**.
   It must pass and show `production_enabled: true`. No build, migration or restart.
3. **Run workflow → main → operation=deploy → Run workflow**.
4. Wait for green **access**, **build**, **production** jobs.
5. **https://ospio.online/release.json** must show the workflow commit.
   **https://ospio.online/health** must return `status: ok`.
   The workflow also checks the installed backend commit through the status helper.
6. Repeat with the other accounts. Releasing the already-live commit checks
   health without another service restart.

Each run records the individual GitHub actor and commit. Ordinary releases
do not require Maria to approve the environment, log in by SSH or toggle a file.

CLI alternative on any machine with the developer's own GitHub login, without
a server key:

```sh
gh workflow run ospio-hotel-deploy.yml --repo Maria7557/hotel-automation --ref main -f operation=status
gh workflow run ospio-hotel-deploy.yml --repo Maria7557/hotel-automation --ref main -f operation=deploy
```

## Only if a CI key must be provisioned or deliberately rotated

**Skip this section when the existing-key installer succeeds.** Never ask the
developers for laptop keys. Generate one service pair on the server:

```sh
umask 077
install -d -m 0700 /root/ospio-ci-key
test ! -e /root/ospio-ci-key/id_ed25519
ssh-keygen -t ed25519 -N '' -C ospio-github-actions -f /root/ospio-ci-key/id_ed25519
awk '{print "ospio.online " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub > /root/ospio-ci-key/known_hosts
```

Maria then:
1. Places **entire contents** of `/root/ospio-ci-key/id_ed25519` in the GitHub
   environment secret `OSPIO_HOTEL_DEPLOY_KEY`.
2. Places **entire contents** of `/root/ospio-ci-key/known_hosts` in
   `OSPIO_HOTEL_KNOWN_HOSTS`. This comes from the real server host public key.
3. Uses TODO 3's same pinned setup directory and runs:

   ```sh
   python3 "$OSPIO_SETUP_DIR/deploy/install_ospio_deploy.py" --commit "$OSPIO_SETUP_COMMIT" --public-key /root/ospio-ci-key/id_ed25519.pub --enable-production
   ```

4. Completes TODO 4, then removes the temporary private-key file from
   `/root/ospio-ci-key`. The permanent private-key copy belongs in GitHub, not
   on a teammate's computer. Do not send it to anyone or paste it in chat.

If GitHub CLI is available in that administrator session, upload without
displaying the private value:

```sh
gh secret set OSPIO_HOTEL_DEPLOY_KEY --env ospio-hotel-production --repo Maria7557/hotel-automation < /root/ospio-ci-key/id_ed25519
gh secret set OSPIO_HOTEL_KNOWN_HOSTS --env ospio-hotel-production --repo Maria7557/hotel-automation < /root/ospio-ci-key/known_hosts
```

CLI is optional; the GitHub environment's secret fields accept the same contents.

## Future migrations and upgrades

For a new additive SQL migration, review SQL + Drizzle journal and add its tag,
exact journal timestamp, SHA-256 and `"kind": "additive"` to
`deploy/approved-migrations.json`. Obtain the required code-owner review and merge.
The installed helper reads this approval from the GitHub-verified, root-private
artifact. No Maria SSH edit is needed for each approved additive migration.

Destructive/data-changing migrations need an appropriate reviewed operator and
rollback procedure; do not label them additive. Changes to privileged helper
code itself require a reviewed installer upgrade using TODO 3.

## Troubleshooting

| Error | Action |
| --- | --- |
| Private key missing/malformed | Environment secret needs the whole multiline private service key, not a path or public key. |
| Host key rejected | Maria verifies the actual host public key and updates the known_hosts environment secret. |
| Old receiver/non-JSON status | Maria completes TODO 3 once. |
| Production disabled | TODO 3 with `--enable-production`. No developer-specific or expiring permission is involved. |
| SSH permission denied | Check matching CI public key and forced command in the service account's actual authorization file. |
| Unreviewed migration | Review SQL/journal and the exact approval in `approved-migrations.json`. |
| Main moved | Start a new deploy for current main. |
| Application health failure | The runner restores previous FE/BE directories. Inspect logs before another run. |

An administrator can intentionally remove the enable marker for an emergency
freeze. Normal releases and reboots never remove it.

References: [GitHub workflow access](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[OpenSSH forced commands](https://man.openbsd.org/sshd),
[sudo no-argument rules](https://www.sudo.ws/docs/man/1.9.14/sudoers.man.pdf).
