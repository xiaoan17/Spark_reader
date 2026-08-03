# Security Notes

This is a local-first desktop app. API credentials for MinerU, LLM providers,
and embedding providers are only read by the Rust backend. The frontend settings
surface receives configured/not-configured booleans and never receives stored key
values.

Current storage:

- Settings metadata is stored under the app config directory.
- Secret values are written to a backend-only local secrets file (mode `0600` on
  Unix; on Windows, inherited ACLs are restricted with `icacls` to the current
  OS user).
- Platform key storage (macOS Keychain etc.) is available as an opt-in backend
  via `FOCUSED_READING_SECRET_BACKEND=keychain`; the local file remains the
  default.

