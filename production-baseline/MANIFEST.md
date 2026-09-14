# Production baseline manifest

Recovery date: 2026-09-13  
Project: `theoddjobsappnewyork`  
Region/runtime: `us-central1`, Cloud Functions Gen 1, Node.js 20  
Function count/status: 45, all active  
Deployment batch: 2026-08-03 23:06:29–23:06:31 EDT  
Verified payout build: `59db312b-64cb-4b45-ae3c-0bec7bde847e`

## Recovered archive

The Cloud Console `Download zip` action for active `releasePaymentOnCompletion` version 52 produced an exact deployed source archive with SHA-256:

`b20af904df4ba6c861711ca1e297f14b106ee75e3cfe06aac553f4a439f8175c`

The archive is quarantined outside Git because it contains `.runtimeconfig.json` and legacy logs. No secret value was inspected or copied here.

## Safe source comparison

| File | Deployed SHA-256 | Workspace result |
|---|---|---|
| `admin.js` | `9a49be91d9b67990ee66df0e8dc096e20eab1c33111223596d96508cdd54b3ea` | exact match |
| `adminActivity.js` | `c9d6b9bd748b71092fd0d536d00944f3e08f3fcda06451fae253ecc2ed98907c` | exact match |
| `adminData.js` | `e1b143f1d1ffc0eee35fcb8c570605b77e2ad6a425e757841a2513d34c17974a` | exact match |
| `adminDiscordNotifications.js` | `22821257efdaed93390ca0479c3c384568a5a6f3a332aae880c445e072e8ddbf` | exact match |
| `connections.js` | `337556517cb3af711dd658be27f8d7dc926db4a6e6b9b0a723df01e61fa639ad` | exact match |
| `index.js` | `5be5aae5c1cc3d0bd2a9fbbc0cd6858c145d1d9a5fcd67181bacd6d719f5c38f` | differs only by added SMS module/export |
| `jobAlerts.js` | `5ba24b201887640e592288160b28bb6e9b187dac5bc8e69ad1b035c35695b83a` | exact match |
| `notifications.js` | `4baa7fd441dfd0d905edaa14e81fc73d57b9e171aca37162e7a73b67600c0647` | exact match |
| `payments.js` | `2cf777bd04bc96f1e0cae58cb0d504a8a4b10aee1011bf8dbaa242c409c9e908` | exact match; historical Git exact match |
| `referrals.js` | `8341715da555d851ef4a9af1117c96b6781a2a4d2873eca2f729f50765e542d5` | exact match |
| `userRegistration.js` | `c0e3ae93aa878f8f572666bf31992baedbbac79bb0437efc64826b513dd128d0` | exact match |

Deployed `package.json` SHA-256 is `e244f4cf0169be36db08c9e75d4fbcb56a92d506f1d03efa8b1aeaeeae42a507`; deployed `package-lock.json` is `fb05cd841084c4c32d3ba30a512d2bfbeab43644572890122fe4e29f2c4c8bfb`. Workspace package files differ by the added Twilio dependency used only by the undeployed SMS module.

Recovered rule/config evidence:

- Firestore rules: `326738f1d43732f506bafc174bb266d5adcd8d9f7502e660ee24b940bd30c96b`
- Storage rules: `d8441aa6a21330dee819eefc32e4ae6ac6ef2e89360f9b0814ce50d071c6c014`
- Reconstructed eight-index semantic JSON: `564f8cb27ae160d083c12ed684422a635eb66e53fb09ffee0c8c17d594fd3a4f`
- Current authority-candidate `firebase.json`: `b20a6bcc0df2169f3b3616637130cd0b331fbe174ee14f2cea2d4c724b20740a`
- Current authority-candidate `.firebaserc`: `1d32c2de2e873d7bd0b2ab08b87a1922a90ca1a3a9db624c5efbdf88c984d91d`

Rules were recovered from the active console editors. The index digest describes a semantic reconstruction from the eight deployed index rows, not a byte-identical API export. `firebase.json` and `.firebaserc` are authority candidates; their earlier Gate 4 formatting digests were `8aeca1f6dd010b4b9e7786020b22469cb5ac82b6c4185e99e51a46f03f2517fd` and `95ef9f1512061bf87b1bdd26be21bc4086836a97b50e9656509436ea0de2a8ad`, but neither version is proven to have driven the active deployment.

Runtime/secret contract names are documented in `docs/ENVIRONMENT_CONTRACT.md`. No values are included.
