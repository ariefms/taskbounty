# tests/support — sandbox test environment workarounds

These files exist only because this VM cannot run the stock `near-sandbox`
binary as-is. They do not touch the contract or the test assertions.

## Problem 1: S3 download blocked

`near-workspaces`' build script downloads the sandbox binary from
`https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/...`, which times
out from this VM (the global S3 endpoint is unreachable here; the regional
`https://s3.us-west-1.amazonaws.com/...` endpoint works). The binary was
therefore fetched once with curl from the regional endpoint and placed at:

```
~/.near/near-sandbox-2.14.0/near-sandbox   (near-sandbox 2.14.0, Linux x86_64)
```

`near-workspaces` finds a binary at that path on its own and skips the
download; setting `NEAR_SANDBOX_BIN_PATH` also skips it.

## Problem 2: fd-limit raise is fatal, container forbids it

`neard` raises `RLIMIT_NOFILE` to 65535 at startup and exits if that fails.
This container caps the hard limit at 4096 (`ulimit -Hn` = 4096, cannot be
raised — "Operation not permitted"), so the sandbox exits immediately.

- `nofile-shim.c` → `nofile-shim.so`: an `LD_PRELOAD` shim that makes
  `setrlimit(RLIMIT_NOFILE, …)` report success. Only that one resource is
  faked; all other `setrlimit` calls go to the real libc. The sandbox test
  workload uses far fewer than 4096 fds.
- `near-sandbox-wrapper.sh`: execs the real binary with the shim preloaded.

## How to run the integration test here

```sh
export NEAR_SANDBOX_BIN_PATH="$PWD/tests/support/near-sandbox-wrapper.sh"
cargo near build
cargo test --test integration
```

On a normal machine none of this is needed: unset the variable and let
`near-workspaces` download the sandbox binary itself.
