# Gate 6 source-analysis compatibility repair

Firebase source analysis rejected the first Emergency Option A artifact before upload. The candidate used `require("firebase-functions")` with `firebase-functions@6.6.0`. In that release, the package root exports the v2 API, where `functions.firestore.document` is undefined. The package's explicit `firebase-functions/v1` export provides `firestore.document` and preserves the existing first-generation trigger model.

The repair changes only the import in `functions/index.js` to `require("firebase-functions/v1")`. The exported name, `jobPost/{jobId}` update trigger, completion-to-pending behavior, and zero-Stripe invariant remain unchanged. No v2 migration is authorized.

The previous artifact with SHA-256 `c3110b2f1ccfc735ec2c6694d1a11359f7cc69dbee81594a1837d813208db8ed` is invalid for Gate 6 deployment because Firebase cannot analyze it. It must not be deployed. A replacement artifact and candidate reference are required after validation.

No production resource was changed by the failed source-analysis attempts.
