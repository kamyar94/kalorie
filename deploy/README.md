# Deploying Kal with Docker

This folder runs Kal as a hardened Docker stack on a home server (Windows with Docker Desktop and
Windows PowerShell 5.1). It holds templates and scripts only: no secrets and no addresses of real
machines. Every address below, such as `cal.example.org`, is a placeholder for your own.

```
cal/                              a clone of the repository
  Dockerfile  .dockerignore
  deploy/                         this folder
    docker-compose.yml            the stack
    squid.conf  squid-start.sh    the egress proxy: allowlist and the script that adds site hosts
    .env                          pinned versions and non-secret defaults (committed)
    site.env                      this site's addresses, from site.env.example (git ignores it)
    db.env  app.env  vapid.env    secrets, made by Start.ps1 on the first start (git ignores them)
    cloudflared.env               the Cloudflare tunnel token, from cloudflared.env.example (secret)
    Start.ps1  Status.ps1  Backup.ps1  Cal.ps1   the scripts you use
    photos/  backups/             the photos and the database dumps (git ignores them)
    test/                         the full local test of this stack (development PCs only)
```

The secret files are read only by the containers that need them. Start.ps1 locks them, and the
folders it creates, to your account, SYSTEM and Administrators. Do not run `git clean -x` in this
folder, and keep a copy of `app.env` with your backups (Backup.ps1 does).

## The services

Five services, and only two of them can reach the internet. Every container runs without Linux
capabilities, with `no-new-privileges`, on a read-only root filesystem and with limits on memory,
CPU and processes, and its log files rotate. No service publishes a port on the host.

| Service  | What it is                                                                                         | Networks            | Runs as                           |
| -------- | -------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------- |
| `app`    | The web app (`node dist/start.mjs`): applies the database migrations, then serves Kal on port 3000 | tunnel, backend     | node (1000)                       |
| `worker` | The same image, `node dist/worker.mjs`: photo analysis and push messages                           | backend             | node (1000)                       |
| `db`     | Postgres, data in the Docker volume `db`                                                           | backend             | postgres (70)                     |
| `egress` | Squid, the only way out for `app` and `worker`                                                     | backend, egress-out | the image's own unprivileged user |
| `tunnel` | Cloudflare Tunnel connector                                                                        | tunnel, tunnel-out  | nonroot (65532)                   |

The networks `tunnel` and `backend` are internal, which means they have no route to the internet.
Only `egress-out` (for the proxy) and `tunnel-out` (for the connector) lead out.

- **app** is built from the repository (`Dockerfile`, multi-stage, pinned Node on Alpine, no source
  maps, no package manager, no tests in the final image, about 315 MB). Its only writable places are
  a 64 MB `/tmp` in memory, Next.js's cache in memory, the photo folder and the `fdc-cache` volume.
- **worker** takes jobs from the Postgres queue. It mounts the photo folder read-only and writes a
  heartbeat file every 15 seconds that its health check reads.
- **egress** accepts HTTPS tunnels (`CONNECT` on port 443) to the hosts in `squid.conf` and refuses
  everything else: other hosts, other ports, plain http and bare IP addresses. Kal encrypts end to
  end through the tunnel, so the proxy sees only which host is contacted. The allowed hosts are the
  three AI APIs (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`), Open
  Food Facts (`world.openfoodfacts.org`), the FoodData Central downloads (`fdc.nal.usda.gov`), the
  Web Push services (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`,
  `*.notify.windows.com`), and the hosts that you set in `site.env`: the host of
  `MEALIE_BASE_URL`, of `OPENGYM_BASE_URL` and of a different `OFF_BASE_URL`, plus anything listed in
  `PUSH_SERVICE_HOSTS` and `EGRESS_EXTRA_HOSTS`. `squid-start.sh` writes that second part when the
  container starts (the image has no `mkdir`, `sed` or `tr`, so it is plain `sh`). To allow one more
  host, add it to `EGRESS_EXTRA_HOSTS` in `site.env` and run `docker compose restart egress`.
  The proxy writes no cache and no files, and its log has one line per tunnel with the host and
  port. `app` and `worker` send every outside call through it (`EGRESS_PROXY_URL`), including
  Mealie and openGym, so those two must be `https` addresses.
- **tunnel** is the Cloudflare connector. Cloudflare's edge ends HTTPS for your public address and
  the connector forwards the traffic to `app:3000` over the internal `tunnel` network. Its token
  lives only in `cloudflared.env`.

What is secret, and who reads it: `db.env` (the database login) is read by `db`, `app` and `worker`;
`app.env` (the key that encrypts every person's saved AI keys and the Mealie and openGym tokens)
and `vapid.env` (the Web Push keys) by `app` and `worker`; `cloudflared.env` by `tunnel` only.
`.env` and `site.env` hold no secrets, and `app` and `worker` read them too.

## First start

1. **Get the code and Docker.** Clone the repository into a folder of your choice on the
   server and start Docker Desktop. Open PowerShell in the `deploy` folder.

2. **Settings of your site.** Run `powershell -ExecutionPolicy Bypass -File .\Start.ps1 -NoTunnel`.
   On a new folder it copies `site.env.example` to `site.env` and stops. Open `site.env` in Notepad
   and set `BASE_URL` (the public address, `https://cal.example.org`), `OFF_CONTACT` and
   `VAPID_SUBJECT` (your contact address, which the push services and Open Food Facts see). Add
   `MEALIE_BASE_URL` and `OPENGYM_BASE_URL` if you use those servers; leave them out to turn the
   integrations off.

3. **Cloudflare tunnel.** In the Cloudflare dashboard open Zero Trust, Networks, Tunnels, and choose
   **Create a tunnel**, then **Cloudflared**. Name it `cal`. On the next page Cloudflare shows an
   install command that ends in a long token: copy only the token (it starts with `eyJ`). Copy
   `cloudflared.env.example` to `cloudflared.env` and paste the token right after `TUNNEL_TOKEN=`
   (no quotes, no spaces). In the tunnel's **Public hostname** tab add the hostname
   `cal.example.org`, with service type **HTTP** and URL `app:3000`. The connector reaches the app by
   that name over the internal network, so nothing on the server listens for it. You do not need a
   Cloudflare Access policy: Kal has its own sign-in and accepts only invited people. If you add
   one anyway, leave `/sw.js` and `/manifest.webmanifest` reachable without it, or installed apps
   cannot update.

4. **First setup without the tunnel.** Run `.\Start.ps1 -NoTunnel`. It makes `db.env`, `app.env` and
   `vapid.env` with random values that are never shown, locks them, pulls the pinned images, builds
   the Kal image (a few minutes), starts the database, proxy, app and worker, and waits until the
   app answers and the worker reports in. Nothing is reachable from outside yet. Then load the
   food data and make the first invite code:

   ```
   powershell -ExecutionPolicy Bypass -File .\Cal.ps1 import-fdc
   powershell -ExecutionPolicy Bypass -File .\Cal.ps1 seed-dishes
   powershell -ExecutionPolicy Bypass -File .\Cal.ps1 invite --admin --note first-admin
   ```

   `import-fdc` downloads the USDA FoodData Central files (about 13 MB) through the proxy into the
   `fdc-cache` volume, checks each file's SHA-256 and imports about 13,700 foods (a minute or two on
   the first run). `seed-dishes` adds the Persian dish set and recomputes dishes. The invite command
   prints a one-time code and a link that starts with your `BASE_URL`; the code works once and
   expires after 7 days.

5. **Go live.** Run `.\Start.ps1`. It checks the token, starts the tunnel and waits for
   `Registered tunnel connection`. Open your address, use the invite link, choose a username and
   password, and add each person's AI key under Settings, AI (the keys are theirs, encrypted with
   `app.env`'s key).

`-SkipPull` uses the images already on the computer; `-SkipBuild` uses the Kal image already built;
`-TunnelWaitSeconds` changes how long Start.ps1 waits for the tunnel (60 by default).

## Daily use

- `.\Status.ps1` shows the containers and their health, whether the app answers, the number of
  accounts, foods and waiting jobs, that no port is published, the age of the newest backup and the
  last tunnel log lines.
- `.\Cal.ps1` runs the server tool in the app container: `invite [--admin] [--note NAME] [--days N]`,
  `reset USERNAME`, `users`, `unlock USERNAME`, `admin USERNAME on|off`, `disable USERNAME`,
  `enable USERNAME`, `invites`, `import-fdc`, `seed-dishes`. Run it without arguments for the list.
  (It wraps `node dist/cal.mjs`, the bundled `scripts/cal.mjs`.)
- **Update.** Take a backup, pull the new code, run `.\Start.ps1` (it rebuilds, restarts, and the
  app applies new migrations when it starts):

  ```
  .\Backup.ps1
  git pull
  .\Start.ps1
  ```

  Versions of Node, Postgres, Squid and cloudflared are in `.env`; change one and run Start.ps1.
  Keep Postgres on the same major version (18.x): a new major needs a dump and restore.

## Kal for Android

The Android app (the repository's `android/` folder) is built on a development PC by
`scripts/android-build.mjs`, never on the server, and never committed. The server only hands it
out and vouches for it:

1. Copy the build's `kal.apk` and `version.json` into `deploy/android/` (git ignores the folder;
   `CAL_ANDROID_DIR` in `.env` points elsewhere if you like). The app container mounts it
   read-only at `/data/android`. To update the app, replace both files; no restart is needed.
2. In `site.env`, set `ANDROID_APP_ID` to the `kal.appId` the app was built with and
   `ANDROID_CERT_SHA256` to the certificate fingerprint the build script printed. Run
   `.\Start.ps1` (or restart the app container) after a change.
3. Check `https://cal.example.org/.well-known/assetlinks.json`: it must answer with JSON naming
   the app and the fingerprint, without a sign-in page in front of it. Android checks it when the
   app is installed; without it the app still works but shows an address bar.

`/android/version.json` is public (the app's update check); `/android/kal.apk` needs a sign-in.
More, then Kal for Android, shows the version and size, or says the app is not set up yet.

## Backup and restore

`.\Backup.ps1` writes `backups\cal-db-<date>.dump` (a `pg_dump` taken inside the db container while
everything keeps running), copies `app.env` and `vapid.env` next to it, and copies the photo folder
to `backups\photos` (new files only; nothing is ever removed from that copy). `-Destination` adds
the same to another folder, for example on another disk or a share. **Nothing is deleted unless you
give `-Keep N`**, which keeps the newest N dumps and removes older ones (the photo copy is never
pruned). A dump holds the scrypt password hashes and every meal, so keep it somewhere private; it is
useless for the saved AI keys without `app.env`.

To restore into a fresh install: copy `app.env` and `vapid.env` back into `deploy`, run
`.\Start.ps1 -NoTunnel` (it creates an empty database), stop the app and worker
(`docker compose stop app worker`), restore, and start again:

```
docker compose exec -T db pg_restore --clean --if-exists --no-owner -d cal /backups/cal-db-<date>.dump
```

Put the `photos` copy back into the photo folder, then run `.\Start.ps1`. Start.ps1 refuses to
make a new `db.env` or `app.env` for a database volume that already exists, because a new password
or key would lock the app out of it.

## Checking the stack

- **No published ports.** `.\Status.ps1` says so, or `docker compose ps --format json` shows empty
  `Publishers` for every service.
- **The allowlist.** From a throwaway container on the backend network (the network is called
  `<project>_backend`, `cal_backend` unless you changed the project name): a provider answers (401
  without a key) and any other host is refused with 403.

  ```
  docker run --rm --network cal_backend curlimages/curl:8.23.0 -s -o /dev/null -w "%{http_connect} %{http_code}\n" -x http://egress:3128 https://api.openai.com/v1/models
  docker run --rm --network cal_backend curlimages/curl:8.23.0 -s -o /dev/null -w "%{http_connect} %{http_code}\n" -x http://egress:3128 https://example.com/
  docker run --rm --network cal_backend curlimages/curl:8.23.0 -s -m 5 https://example.com/
  ```

  The third command, a direct request, has no route at all.

- **The whole thing.** `deploy\test\Test-Stack.ps1` builds the image, starts everything as a
  separate compose project called `caltest`, runs a browser test and about seventy checks (no
  published ports, non-root, read-only, zero capabilities, no direct route out, the proxy
  allowlist, secrets absent from the image, `docker inspect` and the logs, another person's photo
  refused), and removes everything again. It is for a development PC, not the server. Run it with
  `-FdcCache <folder with the cached FoodData Central zips>`.

## If something goes wrong

- **"all predefined address pools have been fully subnetted"**: copy
  `docker-compose.override.example.yml` to `docker-compose.override.yml`, give the four networks
  unused subnets, and run Start.ps1 again.
- **The tunnel does not connect**: `docker compose logs tunnel`. "Unauthorized" or "token is not
  valid" means the token in `cloudflared.env` is wrong or from a deleted tunnel.
- **A call to an AI provider, Mealie or openGym fails with a connection error**: look at
  `docker compose logs egress`. A line with `403` names the host the proxy refused; if it is one you
  want, add it to `site.env` (see the egress service above).
- **Push notifications do not arrive on a phone**: the app must be installed to the home screen
  (iOS 16.4 or later), notifications must be on in Settings, and the push service of the phone must
  be reachable through the proxy (`PUSH_SERVICE_HOSTS` if it is not one of the known four).
- **The app is slow to start after an update**: it waits for the database and applies migrations
  first; `docker compose logs app` shows where it is.
