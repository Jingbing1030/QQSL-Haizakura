# Satori adapter tests

`run-satori-tests.mjs` drives the **real built bundle**, not a mock, so it proves
the adapter works in the exact code shape that ships.

```bash
cd restored
node scripts/build.mjs                       # produces dist/index.mjs
node scripts/tests/run-satori-tests.mjs      # 71 protocol/API assertions
node scripts/tests/run-satori-integration.mjs # 22 mount/NetworkManager assertions
```

## How it works

`dist/index.mjs` is one flat scope that **executes `main()` at the bottom**. The
harness therefore copies the bundle and truncates it just before
`//#region src/index.ts` (the entry module), then appends a test driver inside an
`async function` so no harness identifier can collide with the bundle's ~8400
top-level names. Everything above the entry has already run, so
`SatoriServerAdapter` and the mount patches are live.

The Satori WebSocket protocol logic is exercised through a **socket double** that
mimics the subset of the `ws` API the adapter uses. A real WebSocket connection
cannot be opened on this machine: the vendored `ws` server decodes frames through
a native addon (`websocket-<platform>-<arch>.node`) and only the arm64 binary
ships upstream. The protocol state machine being tested is ours, not the
vendored framing, so the double is a faithful substitute — but **true wire-level
WS handshake/framing is NOT covered here**. Verify that on an arm64 host.
