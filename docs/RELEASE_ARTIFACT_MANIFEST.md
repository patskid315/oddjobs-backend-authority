# Release artifact manifest contract

Actual immutable manifests are generated beside the ignored artifacts in `release-artifacts/` after the final governance commit. They must contain candidate Git SHA/tag, artifact SHA-256, entry-source and lockfile SHA-256, Node runtime, UTC build timestamp, 45-function inventory SHA-256, baseline/rules/storage/index digests, environment, and operator.

The archives contain only committed Firebase configuration and the narrow pending-only runtime dependency closure. They contain no rules deployment target, webhook, executor, test credentials, source archive, runtime config, or secret value. Deployment is permitted only when a sidecar digest matches the archive and the manifest names the reviewed commit.
