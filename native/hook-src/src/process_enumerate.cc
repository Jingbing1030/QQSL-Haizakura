#include "process_enumerate.h"

#include <algorithm>
#include <cstring>
#include <set>

#include <dirent.h>
#include <unistd.h>

namespace hz {
namespace {

// Reads a single-line /proc file, trimming the trailing newline.
std::string read_proc_line(const std::string& path, size_t limit = 4096) {
  try {
    std::string text = read_file_text(path, limit);
    while (!text.empty() && (text.back() == '\n' || text.back() == '\0')) text.pop_back();
    return text;
  } catch (const Error&) {
    return {};
  }
}

bool parse_pid(const char* name) {
  if (name == nullptr || *name == '\0') return false;
  for (const char* p = name; *p != '\0'; ++p) {
    if (*p < '0' || *p > '9') return false;
  }
  return true;
}

// True when the process has wrapper.node mapped.  QQ's browser process is the
// only one that does: the zygotes and renderers inherit everything else.
bool maps_wrapper_node(int pid) {
  std::string maps;
  try {
    maps = read_file_text(format("/proc/%d/maps", pid), 16u << 20);
  } catch (const Error&) {
    return false;
  }
  // Match the basename so both /opt/QQ/resources/app/wrapper.node and a
  // relocated copy are recognised.
  return maps.find("wrapper.node") != std::string::npos;
}

}  // namespace

std::vector<ProcessInfo> enumerate_processes(const std::string& name_hint) {
  DIR* dir = ::opendir("/proc");
  if (dir == nullptr) fail(format("failed to open /proc: %s", std::strerror(errno)));

  std::vector<ProcessInfo> out;
  while (dirent* entry = ::readdir(dir)) {
    if (!parse_pid(entry->d_name)) continue;
    const int pid = std::atoi(entry->d_name);

    ProcessInfo info;
    info.pid = pid;
    info.name = read_proc_line(format("/proc/%d/comm", pid));
    if (info.name.empty()) continue;  // process vanished

    if (!name_hint.empty() && info.name != name_hint) {
      // Allow "qq" to match "QQ" and versioned names like "qq_3.2.32".
      std::string lower = info.name;
      std::transform(lower.begin(), lower.end(), lower.begin(),
                     [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
      if (lower.find(name_hint) == std::string::npos) continue;
    }

    // The process may die between readdir and these reads; tolerate that.
    try {
      char buf[PATH_MAX];
      const ssize_t n = ::readlink(format("/proc/%d/exe", pid).c_str(), buf, sizeof(buf) - 1);
      if (n > 0) {
        buf[n] = '\0';
        info.exe = buf;
      }
    } catch (const Error&) {
    }

    info.cmdline = read_proc_line(format("/proc/%d/cmdline", pid), 8192);
    // cmdline is NUL separated; flatten for display.
    std::replace(info.cmdline.begin(), info.cmdline.end(), '\0', ' ');

    info.ppid = 0;
    const std::string stat = read_proc_line(format("/proc/%d/stat", pid), 4096);
    // The comm field can contain spaces and parentheses, so parse from the last
    // ')' to avoid mismatching.
    const auto close = stat.rfind(')');
    if (close != std::string::npos) {
      int ppid = 0;
      if (std::sscanf(stat.c_str() + close + 1, " %*c %d", &ppid) == 1) info.ppid = ppid;
    }

    info.has_wrapper_node = maps_wrapper_node(pid);
    out.push_back(std::move(info));
  }
  ::closedir(dir);

  std::sort(out.begin(), out.end(),
            [](const ProcessInfo& a, const ProcessInfo& b) { return a.pid < b.pid; });
  return out;
}

std::vector<ProcessInfo> find_main_processes(const std::string& name_hint) {
  std::vector<ProcessInfo> out;
  for (auto& p : enumerate_processes(name_hint)) {
    if (p.has_wrapper_node) out.push_back(std::move(p));
  }
  return out;
}

ProcessInfo find_single_main_process(const std::string& name_hint) {
  const auto matches = find_main_processes(name_hint);
  if (matches.empty()) {
    fail(format("no QQ process with wrapper.node mapped was found (searched name '%s')",
                name_hint.c_str()));
  }
  if (matches.size() > 1) {
    std::string list;
    for (const auto& m : matches) {
      if (!list.empty()) list += ", ";
      list += format("%d", m.pid);
    }
    fail(format("multiple QQ main processes found (%s); refusing to guess",
                list.c_str()));
  }
  return matches.front();
}

std::string read_process_environ(int pid) {
  try {
    return read_file_text(format("/proc/%d/environ", pid), 1u << 20);
  } catch (const Error&) {
    return {};
  }
}

std::string resolve_in_process(int pid, const std::string& path) {
  if (!path.empty() && path[0] == '/') {
    return format("/proc/%d/root%s", pid, path.c_str());
  }
  return path;
}

}  // namespace hz
