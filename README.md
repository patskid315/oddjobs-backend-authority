# OddJobs Backend Authority — Gate 5 Candidate

This isolated local repository is a recovery/prototype workspace. It is **not production authority and must not be deployed**. Production mapping is explicit; implicit default deployment is deliberately invalid.

The recovered rules and indexes are baseline evidence, not approved future policy. The Gate 5 implementation proves the settlement, idempotency, lease, webhook, and reconciliation contracts locally. It is disabled by default and has not been deployed.

Evidence and release plans are under `docs/`. Run unit tests with `npm test --prefix functions`, Emulator tests with `npm run test:emulator --prefix functions`, and release checks with `npm run verify:release --prefix functions`.
