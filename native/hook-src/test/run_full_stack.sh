#!/bin/sh
# Drives test/full_stack_test.mjs against a fresh fake_target.
#
# Kept as a script rather than a ctest entry because it needs two things ctest does not manage:
# a live target process with a wrapper.node mapping, and sudo (ptrace under yama).  Making it a
# ctest would either skip silently on machines without that, or fail for reasons unrelated to
# the code under test.
set -e

# Absolute: the addon is loaded by path and a relative one resolves against the caller's cwd.
SELF=$(cd "$(dirname "$0")" && pwd)
BUILD=$(cd "${BUILD:-$SELF/../buildx}" && pwd)
NODE=${NODE:-node}
THREADS=${THREADS:-96}

WORK=$(mktemp -d "${TMPDIR:-/tmp}/hzfs.XXXXXX")
PIDFILE="$WORK/pid"
HBFILE="$WORK/hb"

cleanup() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

rm -f /tmp/hz-control.sock /tmp/hz-control.recv.sock /tmp/hz-control.started
"$BUILD/fake_target" --orphan "$PIDFILE" --heartbeat "$HBFILE" --threads "$THREADS" \
  > "$WORK/target.log" 2>&1 &
sleep 2
PID=$(cat "$PIDFILE")
echo "target pid=$PID threads=$THREADS"

# The payload reads HZ_* from the TARGET's environment, so a variable set in this shell never
# reaches it: the injector does not forward environment, and forwarding would be wrong anyway
# (the target is the process the socket belongs to).  The paths are therefore DERIVED here with
# the same rule the payload uses, which is also what makes this test independent of where the
# caller's runtime directory happens to be.
#
# getRuntimeDir(): SNOWLUMA_HOOK_RUNTIME_DIR, then XDG_RUNTIME_DIR, then /tmp/snowluma-<uid>.
RUNTIME_DIR=$(sudo sh -c "tr '\0' '\n' < /proc/$PID/environ | sed -n 's/^XDG_RUNTIME_DIR=//p'" | head -1)
[ -n "$RUNTIME_DIR" ] || RUNTIME_DIR="/tmp/snowluma-$(id -u)"
echo "target runtime dir=${RUNTIME_DIR}"

sudo sh -c "HZ_RUNTIME_DIR='$RUNTIME_DIR' '$NODE' '$SELF/full_stack_test.mjs' \
   '$BUILD/haizakura-hook-linux-x64.node' '$PID' '$BUILD/payload.so'"
