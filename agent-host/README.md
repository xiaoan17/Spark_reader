# Agent Host

This package is experimental and currently not wired into the shipped Tauri app.

The real product path runs the agentic RAG tool loop in Rust
(`src-tauri/src/interpretation.rs`) and calls storage/search functions directly.
This package expects a local book-tool HTTP server, but the Rust backend does not
provide that server today and this package is not bundled in release builds.

