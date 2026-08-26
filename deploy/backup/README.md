# Disaster recovery — backup and restore

Backups are produced by the `hrcopilot-backup` CronJob defined in
[`../hrcopilot/templates/backup.yaml`](../hrcopilot/templates/backup.yaml).
One job produces one consistent, checksummed, self-describing set.

---

## Status: off-server backups are LIVE

Every nightly backup is uploaded to a **private Cloudflare R2 bucket**
(`hrcopilot-backups`), verified there with `rclone check`, and pruned on a
14-day schedule. A total loss of the VPS disk no longer loses the backups.

Proven on 2026-08-26 against real R2: upload of all 10 artefacts, `rclone
check` 0 differences, a full download round-trip with every SHA256 digest
matching the source, and unsigned public access refused.

## What is backed up

| Component | What | How |
|---|---|---|
| PostgreSQL | `hr_copilot`, `hr_copilot_payments`, `hr_copilot_notifications` | `pg_dump` plain SQL + gzip, one file per database |
| Qdrant | every collection, discovered at run time | snapshot API, downloaded off the Qdrant volume, then deleted server-side |
| Uploaded files | the whole `backend-storage` PVC (resumes, documents, avatars) | `tar -czf`, read-only mount |
| Metadata | `manifest.json` + `checksums.sha256` | see below |

Deliberately **not** backed up: Kubernetes Secrets and `.env` files. See
[Secret recovery](#secret-recovery).

## Layout

```
hrcopilot-backups/YYYY/MM/DD/<YYYYMMDDTHHMMSSZ>/
  postgres/<database>.sql.gz
  qdrant/<collection>.snapshot
  files/storage.tar.gz
  manifest.json
  checksums.sha256
```

`manifest.json` records the backup id, UTC timestamp, Helm revision, the image
tag of every service, per-artefact filenames and byte counts, the source file
count and byte total, and the remote prefix. It contains no secrets. Restoring
onto the image tags named in the manifest is what makes a restore reproducible
rather than approximate.

## Schedule and retention

| | |
|---|---|
| Schedule | daily, `0 3 * * *` **Asia/Seoul** (expressed as a `timeZone`, not hand-converted UTC) |
| Duration | ~15–25 seconds at current data volume |
| Off-server retention | 14 days |
| On-node retention | 3 days (local copies exist only for fast same-day restores) |
| Retention safety | age-based only; the newest backup is never pruned, and pruning is skipped entirely if no completed backup can be listed |

## RPO / RTO

* **RPO — up to 24 hours.** Backups are nightly, so a failure just before
  03:00 KST loses almost a day of work. Everything since the last backup is
  gone except what a provider can re-supply (external job listings re-sync
  hourly and would refill within an hour of the platform returning).
* **RTO — realistically 3–6 hours** for a full rebuild onto a fresh VPS,
  assuming the operator is available and the DNS TTL (180s) has propagated.
  Roughly: 60–90 min to provision the node and platform (k3s, Traefik,
  cert-manager, Helm, secrets), 20–30 min to restore data at current volumes,
  30–60 min to deploy and verify the application, plus contingency. **Do not
  quote a sub-hour RTO**: no part of this has been rehearsed end-to-end on a
  genuinely fresh machine, and the first real attempt always finds something.
* Restore of the *data* alone, onto a cluster that is already running, is
  much faster — the restore drills below each complete in seconds to minutes.

---

## Full recovery: rebuilding from nothing

1. **Provision a fresh VPS** (Ubuntu 24.04). Harden SSH, enable UFW for
   22/80/443 only.
2. **Install the platform**: k3s, Traefik, cert-manager, Helm. See
   `/root/platform/BASELINE.md` on the current node for the policies this
   cluster was built with.
3. **Recreate the Secrets** — see [Secret recovery](#secret-recovery). Nothing
   below will start without them.
4. **Deploy the data layer only**: `helm upgrade --install hrcopilot
   deploy/hrcopilot -f deploy/hrcopilot/values-prod.yaml` with every entry
   under `apps:` set to `enabled: false`. Bring up Postgres, Redis, Kafka and
   Qdrant first, with no application writing to them.
5. **Restore PostgreSQL** (below). Restore *before* the backend runs, so that
   Prisma migrations do not race the restore.
6. **Restore Qdrant** (below).
7. **Restore uploaded files** (below).
8. **Deploy the application** with the image tags recorded in
   `manifest.json`, then re-enable the `apps:`.
9. **Verify health**: `/health/live` and `/health/ready` on the API, a login,
   and one candidate and one HR surface.
10. **Verify external job sync**: within an hour, `hrcopilot_external_sync_last_success_timestamp_seconds`
    should advance for every scheduled provider.
11. **Verify monitoring and notifications**: install `deploy/monitoring`, then
    confirm Prometheus targets are up and a test alert reaches its receiver.

Restore order matters: **databases → vector store → files → application**. The
application must be the last thing that starts.

---

## Finding and verifying a backup

```sh
# Latest backup, off-server:
rclone --config /r2/rclone.conf lsf r2:hrcopilot-backups -R --dirs-only \
  | grep -E '[0-9]{8}T[0-9]{6}Z/$' | sort | tail -1

# On-node:
ls -1 /backups | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -1
```

Always verify before trusting:

```sh
cd <backup-dir> && sha256sum -c checksums.sha256
```

A backup that does not pass this is not a backup. Use the previous one.

## Restore: PostgreSQL

Restore into a **new** database first and compare, unless you are rebuilding
from nothing:

```sh
gunzip -c postgres/hr_copilot.sql.gz \
  | psql -h postgres -U postgres -d <target> -v ON_ERROR_STOP=1
```

`ON_ERROR_STOP=1` is not optional — without it `psql` reports success while
skipping every statement that failed.

Check afterwards: table count, `_prisma_migrations` (36 rows at the time of
writing) for `hr_copilot`, `flyway_schema_history` for the two Java services,
and representative row counts against the manifest's era.

## Restore: Qdrant

Upload each snapshot under the collection name it should take:

```sh
curl -X POST -H 'Content-Type: multipart/form-data' \
  -F snapshot=@qdrant/external_jobs_v1.snapshot \
  'http://qdrant:6333/collections/external_jobs_v1/snapshots/upload?priority=snapshot'
```

Then confirm `points_count`, that vectors are `size=384 distance=Cosine`, that
the collection status is `green`, and that a query returns hits.

To rehearse without touching live data, upload to `restore_test_<name>` — the
backup job deliberately skips collections with that prefix, so a drill cannot
inflate the next backup. Delete the drill collections afterwards.

**Secondary recovery path:** the vector store is derived data. If a snapshot
is unusable, the collections can be rebuilt from PostgreSQL by re-indexing
(external jobs reconcile automatically; resumes and vacancies re-index from
their stored text). This is slow and costs embedding compute, so it is a
fallback, never the plan.

## Restore: uploaded files

```sh
sha256sum -c checksums.sha256          # verify first
tar -xzf files/storage.tar.gz -C <target>
find <target> -type f | wc -l          # must equal manifest sourceFileCount
```

Restore into an empty directory and swap it in; never extract over live
storage.

---

## The R2 credential

The job reads one Kubernetes Secret, `backup-r2`, holding an `rclone.conf`.
It is created out-of-band on the cluster and exists nowhere else — not in
this repository, not in any values file:

```sh
umask 077
cat > /dev/shm/rclone.conf <<'EOF'
[r2]
type = s3
provider = Cloudflare
access_key_id = <ACCESS_KEY_ID>
secret_access_key = <SECRET_ACCESS_KEY>
endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF
kubectl -n hrcopilot create secret generic backup-r2 \
  --from-file=rclone.conf=/dev/shm/rclone.conf \
  --dry-run=client -o yaml | kubectl apply -f -
shred -u /dev/shm/rclone.conf
```

`no_check_bucket = true` is **required**, not cosmetic. The token is scoped
to Object Read & Write on this one bucket, so it cannot call `ListBuckets`
or `CreateBucket`; without this flag rclone runs a bucket-existence check
first and every operation fails with `AccessDenied`. That narrow scope is
deliberate — it is also why a mistaken command cannot reach any other
bucket in the account.

The bucket must already exist and must stay **private**: no public access,
no r2.dev development URL, no custom domain. Rotate the token by repeating
the command above; nothing else changes.

## Secret recovery

Backups contain no secrets, by design — an attacker who obtains a backup must
not thereby obtain the keys to production. These must be recreated from your
own secure store when rebuilding:

| Secret | Contents |
|---|---|
| `postgres-credentials` | Postgres superuser + per-service passwords |
| `backend-secrets` | `SECRET_TOKEN`, `DATABASE_URL`, internal service tokens, `EXCHANGE_RATE_API_KEY` |
| `ai-secrets` | Gemini API key |
| `payment-secrets` | Toss client/secret keys, DB URL |
| `notification-secrets` | SMTP settings, DB URL, internal tokens |
| `regcred` | GHCR pull credentials |
| `backup-r2` | R2 backup token (above) |
| `grafana-admin`, `postgres-exporter-dsn` | monitoring (see `../monitoring/README.md`) |

Rotate anything you cannot positively account for.

## Monitoring

Four alerts in `../monitoring/rules-hrcopilot.yaml` watch this system:
`HRCopilotBackupJobFailed`, `HRCopilotBackupStale` (>26h, so one missed
nightly run pages), `HRCopilotBackupRunningTooLong`, and
`HRCopilotBackupSuspended`. A silently suspended CronJob would otherwise
produce no failure and no stale signal for a full day.

## Storage cost

One backup is ~90 MB (Qdrant snapshots ~87 MB of it; databases ~5.9 MB;
uploads compress to ~1.4 MB). Fourteen daily copies are therefore ~1.26 GB.
At Cloudflare R2's published $0.015/GB-month that is under **$0.02/month**,
with no egress charge for restores.
