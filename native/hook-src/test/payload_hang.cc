// A payload whose entry point never returns.
//
// It is the pathological shape of a real hook that deadlocks during start-up: the
// callee blocks forever, the injector must still give up, and the target must
// still end up detachable.  Without this case the timeout and the
// "TracerPid is 0 afterwards" guarantee are only ever exercised on the happy
// path, which is exactly where they do not matter.
//
// It sleeps rather than spinning so the thread stays interruptible and the test
// measures our timeout instead of the machine's CPU.

#include <unistd.h>

extern "C" int snowluma_linux_hook_start_dynamic() {
  for (;;) ::sleep(1);
  return 1;
}
