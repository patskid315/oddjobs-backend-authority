# V2 Geoclient validator adapter (local implementation)

`createNYCGeoclientValidator` implements the existing `NYC_GEOCLIENT_V2`
`validateExactAddress(address, inputDigest)` boundary. No callable/export,
provider secret binding, production configuration or deployment is added.

## Configuration and confidentiality

The server composition layer injects `getSubscriptionKey`, a synchronous or
async secret accessor. The default reads `NYC_GEOCLIENT_SUBSCRIPTION_KEY` from
the server environment only when invoked. A later callable can supply its
bound secret's accessor. No key is needed to import the module or run tests.
The key is sent only in `Ocp-Apim-Subscription-Key` to the fixed HTTPS NYC API
endpoint; redirects are rejected. Do not instrument injected HTTP/accessors
to log headers or address URLs. Provider errors/bodies are never propagated.
There is one total timeout (10 seconds by default, at most 30 seconds), a
256 KiB response limit and no automatic retry. `fetchImpl` is injectable.

## Evidence mapping

The structured house number, street and ZIP become `/address` parameters
`houseNumber`, `street`, `zip`. Unit, owner and client borough hints are not
accepted by the adapter. The existing authority removes unit before calling it.

Function 1B contains both a street-range (1EX) and real property (1AX) result.
Both primary return codes must be `00`; aliases, when present, must agree.
Warnings, messages, reason codes, changed house number/street/ZIP, missing BBL,
conflicting borough evidence and candidate arrays remain unresolved. Borough
comes from the returned BBL borough, never a client hint or ZIP lookup table.
The protected provider reference is `bbl:<provider-returned BBL>`.

Input matching is intentionally conservative: only case and whitespace are
normalized. Abbreviations, aliases, spelling corrections and vanity-address
substitutions that differ from the returned normalized street are unresolved,
even if the provider recognizes them. This does not claim full NYC-address
coverage or introduce client confirmation as geographic authority.

`/address` does not document dataset-version fields. The documented `/version`
endpoint supplies `geosupportVersion`. The adapter reads it before and after
the address lookup and rejects different evidence. `dataset_version` records
the observed Geosupport version/release and a 128-bit prefix of the SHA-256
digest of the complete returned Geosupport version object. No fixed mock,
API version or configured guess substitutes for live dataset evidence.
These observations do not provide a provider-side atomic version pin.

## Primary documentation checked 2026-09-23

- [Maintained Geoclient guide](https://mlipper.github.io/geoclient/): sections
  2.3.2, 3.1, 3.11 and 7.1 define codes, address response, version evidence and
  subscription header.
- [NYC repository provenance](https://github.com/CityOfNewYork/geoclient)
  directs users to the maintained project.
- [Maintainer examples](https://github.com/mlipper/geoclient-examples)
  establish the public `https://api.nyc.gov/geoclient/v2` base URL.

All adapter tests use synthetic documented-field responses and injected HTTP.
No live request or real credential has been used. Operational qualification,
secret binding and deployment remain separate from local adapter completion.

## Focused validation

- `node --test functions/test/v2-geoclient-validator.test.js`: 9 passed.
- `node --test --test-name-pattern='borough-only public projection' functions/test/v2-prerequisites.test.js`:
  1 passed, 3 unrelated cases skipped by selection.
- Local Firestore emulator, `v2-command-emulator.test.js`, name filter
  `protected location producer|ambiguous, mismatched, unavailable and non-NYC|conflicting concurrent borough`:
  3 passed, 13 unrelated cases skipped by selection.
- Existing release guard passed; no function export or production inventory changed.
