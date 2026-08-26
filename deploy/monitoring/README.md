# Production monitoring

The declarative source for the `monitoring` namespace. Everything here is
applied to the k3s node at 187.52.126.117; nothing in this directory contains
a secret.

## What is installed

| Release | Namespace | Chart | Purpose |
|---|---|---|---|
| `kps` | monitoring | kube-prometheus-stack 88.5.4 | Prometheus, Alertmanager, Grafana, node-exporter, kube-state-metrics |
| `blackbox` | monitoring | prometheus-blackbox-exporter 11.17.2 | outside-in HTTPS/TLS probes |
| `postgres-exporter` | hrcopilot | prometheus-postgres-exporter | PostgreSQL up/size/connections |
| `redis-exporter` | hrcopilot | prometheus-redis-exporter | Redis up/memory/rejected connections |
| `kafka-exporter` | hrcopilot | prometheus-kafka-exporter | broker health and consumer lag |

The three data-service exporters run in the **hrcopilot** namespace on
purpose. The NetworkPolicies admit only same-namespace pods carrying the
matching `hrcopilot.dev/<svc>-client` label, so that label is what lets each
exporter connect at all. Qdrant is the single exception: Prometheus scrapes
its `/metrics` cross-namespace, which is why `qdrant-access` carries an
explicit namespaceSelector for `monitoring`.

## Secrets (created on the cluster, never in git)

    kubectl -n monitoring create secret generic grafana-admin \
      --from-literal=admin-user=admin --from-literal=admin-password='<generated>'

    kubectl -n hrcopilot create secret generic postgres-exporter-dsn \
      --from-literal=DATA_SOURCE_NAME='postgresql://postgres:<pw>@postgres.hrcopilot.svc.cluster.local:5432/hr_copilot?sslmode=disable'

Note the database is `hr_copilot` (underscore); `hrcopilot` is the namespace.

## Install / update

    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm upgrade --install kps prometheus-community/kube-prometheus-stack \
      --version 88.5.4 -n monitoring -f values-kube-prometheus-stack.yaml
    helm upgrade --install blackbox prometheus-community/prometheus-blackbox-exporter \
      -n monitoring -f values-blackbox.yaml
    helm upgrade --install postgres-exporter prometheus-community/prometheus-postgres-exporter \
      -n hrcopilot -f values-postgres-exporter.yaml
    helm upgrade --install redis-exporter prometheus-community/prometheus-redis-exporter \
      -n hrcopilot -f values-redis-exporter.yaml
    helm upgrade --install kafka-exporter prometheus-community/prometheus-kafka-exporter \
      -n hrcopilot -f values-kafka-exporter.yaml

    kubectl apply -f scrape-targets.yaml
    kubectl apply -f probes.yaml
    kubectl apply -f rules-hrcopilot.yaml

    kubectl -n monitoring create configmap hrcopilot-dashboards \
      --from-file=dashboards/ --dry-run=client -o yaml \
      | kubectl label -f - --local --dry-run=client -o yaml grafana_dashboard=1 \
      | kubectl apply -f -
    kubectl -n monitoring annotate configmap hrcopilot-dashboards \
      grafana_folder="HR Copilot" --overwrite

## Access (nothing is public)

There is no ingress for Grafana, Prometheus or Alertmanager, and the node
firewall exposes only 22/80/443. Reach them over the API server:

    kubectl -n monitoring port-forward svc/kps-grafana 3000:80
    kubectl -n monitoring port-forward svc/kps-prometheus 9090
    kubectl -n monitoring port-forward svc/kps-alertmanager 9093

## Alert delivery

Alertmanager sends over SMTP to the in-cluster Mailpit sink that the product
already uses for transactional mail, so the whole path is real and inspectable
with no external credentials:

    kubectl -n hrcopilot port-forward svc/mailpit 8025

Routing: everything to `ops-email`; `severity=critical` to
`ops-email-critical` (10s group wait, 4h repeat); `Watchdog` and
`InfoInhibitor` to `null` because both fire permanently by design.

## Deliberate omissions

* **Per-PVC usage alerts.** The local-path provisioner is hostPath, so every
  PVC reports the node filesystem (all eight report the same 192.7GiB) and the
  requested size is not an enforced quota. The node disk alert *is* the
  storage alert for every volume.
* **Direct PG↔Qdrant point-count parity.** Qdrant's `/metrics` exposes no
  per-collection point count, and reaching into Qdrant from the backend would
  cross the ai-service's ownership of the vector store. Index health is
  instead covered by `hrcopilot_external_index_pending` (authoritative from
  PostgreSQL) plus new-queue-failure and Qdrant-up alerts.
