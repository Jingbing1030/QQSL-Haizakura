#!/bin/sh
# Injects the payload into a fresh fake_target, runs the SnowLuma-shaped handshake against it, and
# unloads.
#
# The three steps have to be one script: the payload only lives while the process that injected it
# holds the mapping, so a handshake run against a target whose injector already exited finds the
# sockets gone.  Keeping them together also means the sockets are cleaned up on the way out, so a
# rerun does not trip over a stale file.
set -e

# Absolute, because everything below runs through `sudo sh -c` and a relative path would resolve
# against whatever directory sudo happens to start in.
SELF=$(cd "$(dirname "$0")" && pwd)
BUILD=$(cd "${BUILD:-$SELF/../buildx}" && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hzts.XXXXXX")
PIDFILE="$WORK/pid"

cleanup() {
  [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# fake_target loads this at startup; a stale copy for the wrong architecture makes it fail with a
# bare "dlopen failed" that reads like a missing build.
cp "$BUILD/fake-wrapper.node" /tmp/fake-wrapper.node

"$BUILD/fake_target" --orphan "$PIDFILE" --heartbeat "$WORK/hb" --threads 4 \
  > "$WORK/target.log" 2>&1 &
sleep 2
PID=$(cat "$PIDFILE")
echo "target pid=$PID"

# `sudo -E` is ignored on this box ("preserving the entire environment is not supported"), so the
# three variables are handed to a single `sudo sh -c` explicitly.  HZ_CONTROL_SOCK is cleared
# because the derived mojo path is what this test exists to exercise.
sudo sh -c "HZ_ADDON='$BUILD/haizakura-hook-linux-x64.node' HZ_PID='$PID' \
  HZ_PAYLOAD='$BUILD/payload.so' HZ_CONTROL_SOCK= node '$SELF/hold_injection.mjs'" \
  > "$WORK/inject.log" 2>&1 &
INJECTOR=$!
sleep 4

set +e
sudo node "$SELF/ts_handshake_test.mjs" "$PID"
RC=$?
set -e

kill $INJECTOR 2>/dev/null || true
echo "--- payload log ---"
grep -E "socket path|recv peer|op=" "$WORK/target.log" | tail -5 || true
exit $RC
