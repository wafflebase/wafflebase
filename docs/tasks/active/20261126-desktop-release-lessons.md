# Desktop release — lessons

- **`releases/latest` belongs to the server.** This repository publishes server
  releases as "Latest", so the Tauri-docs default endpoint
  (`releases/latest/download/latest.json`) would 404 for every installed app.
  The endpoint is compiled in; a unit test now pins it to `desktop-latest`.
- **Tauri's `APPLE_CERTIFICATE` path matches the signing identity by name.**
  With a same-named older certificate in the login keychain, codesign reports
  the name as ambiguous, and passing the SHA-1 instead is refused ("does not
  match provided identity"). Only a developer machine hits this; the CI runner
  has one certificate. Local signed builds sign with `codesign --keychain`
  from a throwaway keychain instead.
- **`openssl verify` fails Developer ID certificates with "unhandled critical
  extension"** (Apple's marker OIDs). `-ignore_critical` is the right flag;
  the real proof is a `codesign --timestamp` that shows the full chain.
- **New Developer ID certificates are valid ~13 months** (issued 2026-11-26,
  expires 2027-12-26), not the five years older ones had. Renewal is yearly.
- **Generate the signing key off-keychain.** `openssl genrsa` + CSR, then
  `pkcs12 -export -legacy`: the key exists only in the `.p12`, so "which Mac
  holds the private key" cannot recur.
