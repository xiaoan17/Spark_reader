# Security Notes

This is a local-first desktop app. API credentials for MinerU, LLM providers,
and embedding providers are only read by the Rust backend. The frontend settings
surface receives configured/not-configured booleans and never receives stored key
values.

Current storage:

- Settings metadata is stored under the app config directory.
- Secret values are written to a backend-only `.env` file.
- On Unix platforms, that `.env` file is restricted to mode `0600`.
- On Windows, the app restricts inherited ACLs with `icacls` and grants read/write
  access to the current OS user.

This is a pragmatic pre-1.0 storage model for single-user desktop use. A future
hardening pass can migrate secrets to platform key storage such as macOS
Keychain, Windows Credential Manager/DPAPI, and Linux libsecret.

