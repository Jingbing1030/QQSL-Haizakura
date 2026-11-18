// Locating the QQ main process.
//
// QQ runs as a multi-process Electron app: a browser process, zygotes, renderers,
// GPU and network utilities.  Only the browser process loads wrapper.node, and
// that addon is what owns the MSF session, so identifying it is what makes the
// hook possible.  We never trust the process name alone — several children share
// it — and instead look for wrapper.node in the target's own mount namespace.

#pragma once

#include "common.h"

namespace hz {

struct ProcessInfo {
  int pid = 0;
  int ppid = 0;
  std::string name;    // from /proc/<pid>/comm
  std::string exe;     // resolved /proc/<pid>/exe
  std::string cmdline;
  // True when the process has wrapper.node mapped.  Only the QQ browser process
  // does, which is how we pick it out from its own children.
  bool has_wrapper_node = false;
};

// Enumerates processes that look like QQ.  `name_hint` defaults to "qq".
std::vector<ProcessInfo> enumerate_processes(const std::string& name_hint = "qq");

// Same, but only processes whose address space maps wrapper.node.
std::vector<ProcessInfo> find_main_processes(const std::string& name_hint = "qq");

// Convenience for the common case.  Throws when nothing matches so the N-API
// layer can surface a precise message.
ProcessInfo find_single_main_process(const std::string& name_hint = "qq");

// Reads a process's environment, used to honour SNOWLUMA_HOOK_RUNTIME_DIR so the
// runtime directory matches what the target was started with.
std::string read_process_environ(int pid);

// Resolves /proc/<pid>/root + `path` so we address files in the target's mount
// namespace rather than our own.
std::string resolve_in_process(int pid, const std::string& path);

}  // namespace hz
