# k8s-reference/

**These are non-authoritative reference manifests.**

The Helm chart at `infra/charts/lli-saas/` is the sole deployment source of
truth (see [ADR-0001](../docs/adr/0001-helm-is-deploy-source-of-truth.md)).

The YAML files in this directory were used during early development and are
preserved here for reference only. They may be out of date and **must not** be
applied directly. Use `scripts/deploy-pilot.sh` for all deployments.
