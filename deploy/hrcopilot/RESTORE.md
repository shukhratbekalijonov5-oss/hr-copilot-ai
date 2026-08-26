# PostgreSQL restore procedure (hrcopilot namespace)

Backups: PVC `postgres-backups`, files `<db>-<UTC timestamp>.sql.gz`,
retention 14 days, written by CronJob `postgres-backup` (02:30 UTC).
Offsite copy to R2 activates when secret `backup-r2` + values flag exist.

## Inspect available backups
  kubectl -n hrcopilot create job pg-backup-now --from=cronjob/postgres-backup   # fresh dump
  kubectl -n hrcopilot run -it lsbackups --rm --image=busybox --restart=Never \
    --overrides='{"spec":{"containers":[{"name":"lsbackups","image":"busybox","command":["ls","-lh","/b"],"volumeMounts":[{"name":"b","mountPath":"/b"}]}],"volumes":[{"name":"b","persistentVolumeClaim":{"claimName":"postgres-backups"}}]}}'

## Validate a dump WITHOUT touching production data
Apply restore-validation-job.yaml (in this directory, NOT part of the chart):
it restores the newest hr_copilot dump into a scratch database
`restore_check`, counts tables, then drops it. Run after real data exists to
PROVE restorability.

## Full restore of one database (DESTRUCTIVE — deliberate human act only)
1. Scale the owning service to 0 replicas.
2. kubectl -n hrcopilot exec -it postgres-0 -- sh
3. dropdb -U postgres <db> && createdb -U postgres -O <owner> <db>
4. gunzip -c /path/to/dump.sql.gz | psql -U postgres -d <db>
   (mount the backups PVC into the pod via a helper pod as shown above)
5. Scale the service back up; verify application health.

## PVC deletion risk (READ BEFORE ANY CLEANUP)
local-path StorageClass ReclaimPolicy = Delete. StatefulSet data PVCs
(postgres/redis/kafka/qdrant) survive `helm uninstall`, and
`postgres-backups` carries helm.sh/resource-policy: keep — but deleting a
PVC object DELETES ITS DATA. Never `kubectl delete pvc` data volumes
casually.

# Qdrant snapshots
POST http://qdrant:6333/snapshots (full instance) — CronJob `qdrant-snapshot`
(disabled until collections exist). Snapshots are stored inside the qdrant
PVC; restore = qdrant snapshot recovery API or a fresh reindex from
PostgreSQL truth (the vector data is derivable).
