# Environment contract (names only)

Observed process environment names: `GCLOUD_PROJECT`, `GOOGLE_SERVICE_ACCOUNT_JSON`.

Observed legacy Runtime Config names: `discord`, `notify.email`, `notify.password`, `stripe.mode`, `stripe.live.secret`, `stripe.test.secret`.

Observed Secret Manager names: `GOOGLE_SERVICE_ACCOUNT_JSON`.

Values are intentionally excluded. Migration must replace legacy Runtime Config with Secret Manager references and least-privilege service identity.

