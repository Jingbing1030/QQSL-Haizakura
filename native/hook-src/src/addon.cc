// N-API surface.
//
// The JavaScript side only ever touches five entry points.  Keeping that surface
// this small is what makes the addon portable: a different architecture needs a
// different implementation of these five, and nothing else.
//
//   getAllMainProcessAsync()             -> Promise<ProcessInfo[]>
//   listCandidateProcessesAsync(hint?)   -> Promise<ProcessInfo[]>
//   getBackendInfoAsync()                -> Promise<BackendInfo>
//   loadModuleManualAsync(pid, path)     -> Promise<ManualMapHandle>
//   unloadModuleManualAsync(pid, handle) -> Promise<void>
//
// Every entry point does its blocking work on the libuv thread pool, so a target
// that takes hundreds of milliseconds to attach cannot stall the event loop.

#include <node_api.h>

#include <cxxabi.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "common.h"
#include "elf_image.h"
#include "manual_loader.h"
#include "process_enumerate.h"
#include "remote.h"

namespace {

napi_value make_string(napi_env env, const std::string& s) {
  napi_value out = nullptr;
  napi_create_string_utf8(env, s.c_str(), s.size(), &out);
  return out;
}

// Addresses cross the boundary as hex strings.  A JavaScript number cannot hold
// a 64-bit address exactly, and the payload only ever compares and adds them, so
// text is both lossless and obvious about its base.
napi_value make_hex(napi_env env, uint64_t value) {
  char buf[24];
  std::snprintf(buf, sizeof buf, "0x%llX", static_cast<unsigned long long>(value));
  return make_string(env, buf);
}

napi_value hex_array(napi_env env, const std::vector<uint64_t>& values) {
  napi_value out = nullptr;
  napi_create_array_with_length(env, values.size(), &out);
  for (size_t i = 0; i < values.size(); ++i) {
    napi_set_element(env, out, static_cast<uint32_t>(i), make_hex(env, values[i]));
  }
  return out;
}

napi_value make_number(napi_env env, double value) {
  napi_value out = nullptr;
  napi_create_double(env, value, &out);
  return out;
}

napi_value make_uint64(napi_env env, uint64_t v) {
  napi_value out = nullptr;
  napi_create_bigint_uint64(env, v, &out);
  return out;
}

napi_value make_bool(napi_env env, bool v) {
  napi_value out = nullptr;
  napi_get_boolean(env, v, &out);
  return out;
}

napi_value make_int(napi_env env, int32_t v) {
  napi_value out = nullptr;
  napi_create_int32(env, v, &out);
  return out;
}

std::string get_string_arg(napi_env env, napi_value value, const char* what) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &len) != napi_ok) {
    hz::fail(hz::format("%s must be a string", what));
  }
  std::string out(len + 1, '\0');
  size_t written = 0;
  if (napi_get_value_string_utf8(env, value, out.data(), out.size(), &written) != napi_ok) {
    hz::fail(hz::format("failed to read string %s", what));
  }
  out.resize(written);
  return out;
}

int32_t get_int_arg(napi_env env, napi_value value, const char* what) {
  int32_t out = 0;
  if (napi_get_value_int32(env, value, &out) != napi_ok) {
    hz::fail(hz::format("%s must be an integer", what));
  }
  return out;
}

uint64_t get_uint64_prop(napi_env env, napi_value object, const char* name,
                         bool required = true) {
  napi_value prop = nullptr;
  napi_valuetype type = napi_undefined;
  if (napi_get_named_property(env, object, name, &prop) != napi_ok ||
      napi_typeof(env, prop, &type) != napi_ok || type == napi_undefined) {
    if (required) hz::fail(hz::format("handle is missing '%s'", name));
    return 0;
  }
  uint64_t out = 0;
  bool lossless = false;
  if (napi_get_value_bigint_uint64(env, prop, &out, &lossless) == napi_ok) {
    return out;
  }
  // Accept a plain number too, so a handle can round-trip through JSON.
  double d = 0;
  if (napi_get_value_double(env, prop, &d) == napi_ok) {
    if (d < 0) hz::fail(hz::format("%s must not be negative", name));
    return static_cast<uint64_t>(d);
  }
  hz::fail(hz::format("%s must be a bigint or number", name));
}

napi_value process_info_to_object(napi_env env, const hz::ProcessInfo& p) {
  napi_value obj = nullptr;
  napi_create_object(env, &obj);
  napi_set_named_property(env, obj, "pid", make_int(env, p.pid));
  napi_set_named_property(env, obj, "ppid", make_int(env, p.ppid));
  // "comm" is the field name the original addon uses; "name" is kept as an
  // alias because the TypeScript layer reads it.
  napi_set_named_property(env, obj, "comm", make_string(env, p.name));
  napi_set_named_property(env, obj, "name", make_string(env, p.name));
  napi_set_named_property(env, obj, "exe", make_string(env, p.exe));
  napi_set_named_property(env, obj, "cmdline", make_string(env, p.cmdline));
  napi_set_named_property(env, obj, "hasWrapperNode", make_bool(env, p.has_wrapper_node));
  return obj;
}

napi_value process_list_to_array(napi_env env, const std::vector<hz::ProcessInfo>& list) {
  napi_value array = nullptr;
  napi_create_array_with_length(env, list.size(), &array);
  for (size_t i = 0; i < list.size(); ++i) {
    napi_set_element(env, array, static_cast<uint32_t>(i),
                     process_info_to_object(env, list[i]));
  }
  return array;
}

napi_value handle_to_object(napi_env env, const hz::ManualMapHandle& h) {
  napi_value obj = nullptr;
  napi_create_object(env, &obj);
  napi_set_named_property(env, obj, "base", make_uint64(env, h.base));
  napi_set_named_property(env, obj, "entry", make_uint64(env, h.entry));
  napi_set_named_property(env, obj, "size", make_uint64(env, h.size));
  napi_set_named_property(env, obj, "exceptionTable", make_uint64(env, h.exception_table));
  return obj;
}

// ---------------------------------------------------------------------------
// Async plumbing.  One worker template covers every entry point.
// ---------------------------------------------------------------------------

struct WorkBase {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  std::string error;
  virtual ~WorkBase() = default;
  virtual void run() = 0;
  virtual napi_value result(napi_env env) = 0;
};

template <typename Result, typename Fn, typename ToJs>
struct Work final : WorkBase {
  // Capturing lambdas have no default constructor, so both functors are injected
  // rather than assigned after construction.
  Work(Fn fn, ToJs to_js) : fn(std::move(fn)), to_js(std::move(to_js)) {}

  Fn fn;
  ToJs to_js;
  Result value{};

  void run() override {
    try {
      value = fn();
    } catch (const std::exception& e) {
      error = e.what();
    } catch (...) {
      error = "native work failed with an unknown exception";
    }
  }

  napi_value result(napi_env env) override { return to_js(env, value); }
};

void execute_cb(napi_env env, void* data) { static_cast<WorkBase*>(data)->run(); }

void reject(napi_env env, WorkBase* w, const std::string& message) {
  napi_value text = make_string(env, message);
  napi_value error = nullptr;
  napi_create_error(env, nullptr, text, &error);
  napi_reject_deferred(env, w->deferred, error);
}

void complete_cb(napi_env env, napi_status status, void* data) {
  WorkBase* w = static_cast<WorkBase*>(data);
  if (status != napi_ok && w->error.empty()) w->error = "native work was cancelled";

  if (!w->error.empty()) {
    reject(env, w, w->error);
  } else {
    napi_value value = nullptr;
    try {
      value = w->result(env);
    } catch (const std::exception& e) {
      reject(env, w, e.what());
    }
    if (value != nullptr) napi_resolve_deferred(env, w->deferred, value);
  }

  napi_delete_async_work(env, w->work);
  delete w;
}

template <typename Result, typename Fn, typename ToJs>
napi_value schedule(napi_env env, const char* name, Fn fn, ToJs to_js) {
  auto* w = new Work<Result, Fn, ToJs>(std::move(fn), std::move(to_js));

  napi_value promise = nullptr;
  if (napi_create_promise(env, &w->deferred, &promise) != napi_ok) {
    delete w;
    napi_throw_error(env, nullptr, "failed to create native work promise");
    return nullptr;
  }

  napi_value resource_name = make_string(env, name);
  if (napi_create_async_work(env, nullptr, resource_name, execute_cb, complete_cb, w,
                             &w->work) != napi_ok) {
    delete w;
    napi_throw_error(env, nullptr, "failed to create native work");
    return nullptr;
  }
  if (napi_queue_async_work(env, w->work) != napi_ok) {
    napi_delete_async_work(env, w->work);
    delete w;
    napi_throw_error(env, nullptr, "failed to schedule native work");
    return nullptr;
  }
  return promise;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

napi_value GetAllMainProcessAsync(napi_env env, napi_callback_info info) {
  return schedule<std::vector<hz::ProcessInfo>>(
      env, "haizakura:getAllMainProcess",
      []() { return hz::find_main_processes("qq"); },
      [](napi_env e, const std::vector<hz::ProcessInfo>& list) {
        // Pid array, matching the original addon.  The TypeScript layer happens
        // to accept records too, but anything else consuming this addon expects
        // numbers, and a shape change here would be silent at the call site.
        napi_value array = nullptr;
        napi_create_array_with_length(e, list.size(), &array);
        for (size_t i = 0; i < list.size(); ++i) {
          napi_set_element(e, array, static_cast<uint32_t>(i),
                           make_int(e, list[i].pid));
        }
        return array;
      });
}

napi_value ListCandidateProcessesAsync(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  std::string hint = "qq";
  if (argc > 0) {
    napi_valuetype type = napi_undefined;
    napi_typeof(env, argv[0], &type);
    if (type == napi_string) {
      try {
        hint = get_string_arg(env, argv[0], "nameHint");
      } catch (const std::exception& e) {
        napi_throw_error(env, nullptr, e.what());
        return nullptr;
      }
    }
  }

  return schedule<std::vector<hz::ProcessInfo>>(
      env, "haizakura:listCandidateProcesses",
      [hint]() { return hz::enumerate_processes(hint); },
      [](napi_env e, const std::vector<hz::ProcessInfo>& list) {
        return process_list_to_array(e, list);
      });
}

struct BackendInfo {
  std::string platform;
  std::string arch;
  std::string runtime_resolution;
  std::string injection;
};

napi_value GetBackendInfoAsync(napi_env env, napi_callback_info info) {
  // Reports what this build can actually do, so the JavaScript side can refuse a
  // payload the loader cannot handle instead of failing halfway through.
  return schedule<BackendInfo>(
      env, "haizakura:getBackendInfo",
      []() {
        BackendInfo out;
        out.platform = "linux";
#if defined(__x86_64__)
        out.arch = "x64";
        out.injection = "ptrace-manual-elf64-x86_64";
#elif defined(__aarch64__)
        out.arch = "arm64";
        out.injection = "ptrace-manual-elf64-aarch64";
#else
        out.arch = "unsupported";
        out.injection = "unsupported";
#endif
        out.runtime_resolution = "elf64-eh-frame-itanium-rtti";
        return out;
      },
      [](napi_env e, const BackendInfo& info) {
        napi_value obj = nullptr;
        napi_create_object(e, &obj);
        napi_set_named_property(e, obj, "platform", make_string(e, info.platform));
        napi_set_named_property(e, obj, "arch", make_string(e, info.arch));
        napi_set_named_property(e, obj, "runtimeResolution",
                                make_string(e, info.runtime_resolution));
        napi_set_named_property(e, obj, "injection", make_string(e, info.injection));
        return obj;
      });
}

napi_value LoadModuleManualAsync(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) {
    napi_throw_error(env, nullptr,
                     "loadModuleManualAsync(pid, dylibPath) requires 2 arguments");
    return nullptr;
  }

  int32_t pid = 0;
  std::string path;
  try {
    pid = get_int_arg(env, argv[0], "pid");
    path = get_string_arg(env, argv[1], "dylibPath");
  } catch (const std::exception& e) {
    napi_throw_error(env, nullptr, e.what());
    return nullptr;
  }

  return schedule<hz::ManualMapHandle>(
      env, "haizakura:loadModuleManual",
      [pid, path]() {
        hz::RemoteProcess remote(pid);
        // Resolve through the target's mount namespace: the caller's path is
        // meaningful inside that process, not in ours.
        const std::string resolved = hz::resolve_in_process(pid, path);
        hz::ElfImage image(hz::MappedFile::open(resolved));
        hz::ManualLoader loader(remote, image);
        remote.attach();
        auto handle = loader.load();
        remote.detach();
        return handle;
      },
      [](napi_env e, const hz::ManualMapHandle& h) { return handle_to_object(e, h); });
}

napi_value UnloadModuleManualAsync(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) {
    napi_throw_error(env, nullptr,
                     "unloadModuleManualAsync(pid, handle) requires 2 arguments");
    return nullptr;
  }

  int32_t pid = 0;
  hz::ManualMapHandle handle;
  try {
    pid = get_int_arg(env, argv[0], "pid");
    handle.base = get_uint64_prop(env, argv[1], "base");
    handle.entry = get_uint64_prop(env, argv[1], "entry", false);
    handle.size = get_uint64_prop(env, argv[1], "size");
    handle.exception_table = get_uint64_prop(env, argv[1], "exceptionTable", false);
    if (handle.base == 0) {
      hz::fail("handle must be {base, entry, size, exceptionTable}");
    }
  } catch (const std::exception& e) {
    napi_throw_error(env, nullptr, e.what());
    return nullptr;
  }

  return schedule<bool>(
      env, "haizakura:unloadModuleManual",
      [pid, handle]() {
        hz::RemoteProcess remote(pid);
        remote.attach();
        const bool ok = remote.remote_munmap(handle.base, handle.size);
        remote.detach();
        if (!ok) {
          hz::fail(hz::format("remote munmap failed for 0x%llx",
                              static_cast<unsigned long long>(handle.base)));
        }
        return true;
      },
      [](napi_env e, bool) { return make_bool(e, true); });
}

}  // namespace


// ---------------------------------------------------------------------------
// Inspection
//
// The payload asks the addon two questions before it commits to hooking:
// "where is this module actually mapped?" and "where are the functions and
// vtables I need inside it?".  Both answers have to come from the live process,
// not from the file, because the file records file offsets while the hook needs
// runtime addresses.
// ---------------------------------------------------------------------------


namespace {

// Returns the on-disk path of a mapped module, taken from the process's own maps.
std::string module_path_in_maps(int pid, std::string_view module_name) {
  std::string maps;
  try {
    maps = hz::read_file_text(hz::format("/proc/%d/maps", pid), 32u << 20);
  } catch (const hz::Error&) {
    return {};
  }
  size_t pos = 0;
  while (pos < maps.size()) {
    const size_t eol = maps.find('\n', pos);
    const std::string_view line =
        std::string_view(maps).substr(pos, eol == std::string::npos ? std::string::npos
                                                                   : eol - pos);
    pos = (eol == std::string::npos) ? maps.size() : eol + 1;
    const size_t slash = line.find('/');
    if (slash == std::string_view::npos) continue;
    const std::string_view path = line.substr(slash);
    if (path.size() >= module_name.size() &&
        path.compare(path.size() - module_name.size(), module_name.size(), module_name) == 0) {
      return std::string(path);
    }
  }
  return {};
}

// Reads /proc/<pid>/maps and returns the writable, non-file-backed regions --
// where a C++ object can actually live.  Scanning file-backed mappings would
// turn up the vtables themselves and nothing useful.
std::vector<std::pair<uint64_t, uint64_t>> writable_heap_regions(int pid,
                                                                size_t max_regions) {
  std::vector<std::pair<uint64_t, uint64_t>> out;
  std::string maps;
  try {
    maps = hz::read_file_text(hz::format("/proc/%d/maps", pid), 32u << 20);
  } catch (const hz::Error&) {
    return out;
  }

  size_t pos = 0;
  while (pos < maps.size() && out.size() < max_regions) {
    const size_t eol = maps.find('\n', pos);
    const std::string_view line =
        std::string_view(maps).substr(pos, eol == std::string::npos ? std::string::npos
                                                                   : eol - pos);
    pos = (eol == std::string::npos) ? maps.size() : eol + 1;

    const size_t dash = line.find('-');
    const size_t space = line.find(' ');
    if (dash == std::string_view::npos || space == std::string_view::npos) continue;

    // Keep regions that are private, writable and not backed by a file: those
    // are heap and bss, i.e. where instances live.
    const std::string_view perms = line.substr(space + 1, 4);
    if (perms.size() < 4 || perms[1] != 'w' || perms[3] != 'p') continue;
    if (line.find('/') != std::string_view::npos) continue;

    const uint64_t start = std::stoull(std::string(line.substr(0, dash)), nullptr, 16);
    const uint64_t end = std::stoull(std::string(line.substr(dash + 1, space - dash - 1)),
                                     nullptr, 16);
    if (end <= start) continue;
    // Anything smaller than a few pointers cannot hold an object worth patching.
    if (end - start < 64) continue;
    out.emplace_back(start, end);
  }
  return out;
}

}  // namespace

struct SectionOut {
  std::string name;
  uint64_t address = 0;
  uint64_t file_offset = 0;
  uint64_t size = 0;
  uint64_t flags = 0;
  uint64_t entsize = 0;
  uint64_t runtime_address = 0;
};

struct SymbolOut {
  std::string name;
  std::string demangled;
  uint64_t value = 0;
  uint64_t size = 0;
  uint64_t runtime_address = 0;
  uint32_t bind = 0;
  uint32_t type = 0;
  uint32_t shndx = 0;
};

struct InspectOut {
  int pid = 0;
  std::string path;
  uint64_t base = 0;
  uint64_t mapped_start = 0;
  uint64_t mapped_end = 0;
  uint64_t executable_start = 0;
  uint64_t executable_end = 0;
  std::vector<SectionOut> sections;
  std::vector<SymbolOut> dynamic_symbols;
};

// Symbols of the messaging layer, as opposed to the third-party code linked
// into the same module.
//
// The reference addon builds this list from a fixed table of identifiers and
// keeps every defined dynamic symbol whose mangled name contains one of them,
// case-sensitively.  The table is reproduced verbatim below; it is what makes
// wrapper.node report exactly the 86 symbols the inspector is looking for out
// of the 883 it defines.
//
// A namespace-based test is the obvious alternative and is *not* what the
// reference does: MSF and nt::wrapper only account for 84 of the 86.  The two
// stragglers are a std::_Hashtable::_M_insert instantiation that mentions
// "_Hash_nodeIS5_" (matched by "NodeI") and the typeinfo name for
// std::Cr::default_delete<MSF::MSFRequest>.  Matching identifiers rather than
// namespaces also keeps the entries that spell "SessionShell" without being
// reachable from the nt::wrapper nested-name production.
const char* const kSymbolHints[] = {
    "MSF", "Msf", "SSO", "Wrapper", "Kernel",
    "NodeI", "Session", "CreateNTSessionShell", "CreateGProSessionShell",
};

bool is_messaging_symbol(const std::string& name) {
  if (name.empty()) return false;
  // Case-sensitive substring search, exactly as the reference does it: a
  // case-insensitive pass would additionally pull in eleven "_Rb_tree_node" /
  // "_Hash_node" instantiations that spell "node" in lower case.
  for (const char* hint : kSymbolHints) {
    if (name.find(hint) != std::string::npos) return true;
  }
  return false;
}

// Demangles when the runtime demangler is available, otherwise keeps the raw
// name.  Symbol listing must not depend on libstdc++ internals being exported by
// whatever process this addon is loaded into, so failure is not an error.
std::string demangle_name(const std::string& mangled) {
  int status = 0;
  char* demangled =
      abi::__cxa_demangle(mangled.c_str(), nullptr, nullptr, &status);
  if (status != 0 || demangled == nullptr) return mangled;
  std::string result(demangled);
  std::free(demangled);
  return result;
}

napi_value InspectProcessAsync(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) {
    napi_throw_type_error(env, nullptr, "inspectProcessAsync(pid) requires a pid");
    return nullptr;
  }
  int32_t pid = 0;
  if (napi_get_value_int32(env, argv[0], &pid) != napi_ok) {
    napi_throw_type_error(env, nullptr, "pid must be a number");
    return nullptr;
  }

  return schedule<InspectOut>(
      env, "haizakura:inspectProcess",
      [pid]() {
        InspectOut out;
        out.pid = pid;

        // The module path comes from the process's own maps, so nothing has to be
        // assumed about where QQ installed itself.
        hz::RemoteProcess remote(pid);
        const auto module = remote.find_loaded_module("wrapper.node");
        if (!module) throw hz::Error("no wrapper.node is mapped in this process");
        out.base = *module;
        // Ask the target where its own module lives.  Hardcoding QQ's install
        // path works on the reference container and breaks everywhere else.
        out.path = module_path_in_maps(pid, "wrapper.node");
        if (out.path.empty()) throw hz::Error("cannot locate wrapper.node path");

        // The constructor parses headers, the dynamic section, symbols and
        // relocations in one go; only the section table is opt-in.
        hz::ElfImage image(hz::MappedFile::open(out.path));

        out.mapped_start = out.base;
        // Report where the kernel stops mapping the file, not image_size().
        // image_size() is padded for the manual loader's reservation window and
        // covers the whole .bss; the file-backed mapping ends at the last
        // PT_LOAD's p_vaddr + p_filesz, and the .bss tail lives in a separate
        // anonymous mapping that follows it.  On this module the two differ by
        // 0x32000.
        out.mapped_end = out.base + image.loadable_segment_end();

        for (const hz::SectionInfo& sec : image.sections()) {
          if (sec.size == 0) continue;
          out.sections.push_back({sec.name, sec.addr, sec.offset, sec.size, sec.flags,
                                  sec.entsize, out.base + sec.addr});
        }

        // Executable range comes from the program headers, not the section
        // table.  The two disagree for a module like this one: its first PT_LOAD
        // is r-x and spans from vaddr 0, while the executable *sections* inside
        // it start later.  A caller that maps hook trampolines into this range
        // needs the segment view -- the section view reports a range that is too
        // narrow and too high off the base.
        out.executable_start = out.base + image.executable_segment_start();
        out.executable_end = out.base + image.executable_segment_end();

        for (const hz::DynSymbol& sym : image.symbols()) {
          // Only symbols defined in this image belong here.  The undefined ones
          // are imports from libc and from the modules QQ loads alongside, and
          // reporting 1500 of those drowns the 86 that actually live in
          // wrapper.node -- which is what a caller inspecting the module wants.
          if (sym.name.empty() || !sym.defined) continue;
          // Keep the messaging layer's symbols and drop the rest.  wrapper.node
          // exports 883 defined symbols, but 797 of them are third-party code
          // linked in alongside (LZ4, protobuf, tinyxml, libstdc++ internals).
          // The 86 that remain are the ones an inspector is looking for, and
          // listing the rest buries them.  See kSymbolHints for how the set is
          // chosen -- it is the reference addon's identifier table, not a
          // namespace test.
          if (!is_messaging_symbol(sym.name)) continue;
          SymbolOut s;
          s.name = sym.name;
          s.demangled = demangle_name(sym.name);
          s.value = sym.value;
          s.size = sym.size;
          s.runtime_address = out.base + sym.value;
          s.bind = sym.bind;
          s.type = sym.type;
          s.shndx = sym.shndx;
          out.dynamic_symbols.push_back(std::move(s));
        }
        return out;
      },
      [](napi_env e, const InspectOut& out) {
        napi_value obj = nullptr;
        napi_create_object(e, &obj);
        auto set_addr = [&](const char* key, uint64_t value) {
          napi_set_named_property(e, obj, key, make_hex(e, value));
        };
        napi_set_named_property(e, obj, "pid", make_number(e, out.pid));
        napi_set_named_property(e, obj, "path", make_string(e, out.path));
        set_addr("baseAddress", out.base);
        set_addr("mappedStart", out.mapped_start);
        set_addr("mappedEnd", out.mapped_end);
        set_addr("executableStart", out.executable_start);
        set_addr("executableEnd", out.executable_end);

        napi_value sections = nullptr;
        napi_create_array_with_length(e, out.sections.size(), &sections);
        uint32_t index = 0;
        for (const SectionOut& sec : out.sections) {
          napi_value item = nullptr;
          napi_create_object(e, &item);
          napi_set_named_property(e, item, "name", make_string(e, sec.name));
          napi_set_named_property(e, item, "address", make_hex(e, sec.address));
          napi_set_named_property(e, item, "fileOffset", make_hex(e, sec.file_offset));
          napi_set_named_property(e, item, "size", make_hex(e, sec.size));
          napi_set_named_property(e, item, "flags", make_hex(e, sec.flags));
          napi_set_named_property(e, item, "runtimeAddress",
                                  make_hex(e, sec.runtime_address));
          napi_set_element(e, sections, index++, item);
        }
        napi_set_named_property(e, obj, "sections", sections);

        napi_value symbols = nullptr;
        napi_create_array_with_length(e, out.dynamic_symbols.size(), &symbols);
        index = 0;
        for (const SymbolOut& sym : out.dynamic_symbols) {
          napi_value item = nullptr;
          napi_create_object(e, &item);
          napi_set_named_property(e, item, "name", make_string(e, sym.name));
          napi_set_named_property(e, item, "demangled", make_string(e, sym.demangled));
          napi_set_named_property(e, item, "value", make_hex(e, sym.value));
          napi_set_named_property(e, item, "size", make_hex(e, sym.size));
          napi_set_named_property(e, item, "runtimeAddress",
                                  make_hex(e, sym.runtime_address));
          napi_set_named_property(e, item, "bind", make_number(e, sym.bind));
          napi_set_named_property(e, item, "type", make_number(e, sym.type));
          napi_set_named_property(e, item, "sectionIndex", make_number(e, sym.shndx));
          napi_set_element(e, symbols, index++, item);
        }
        napi_set_named_property(e, obj, "dynamicSymbols", symbols);
        return obj;
      });
}


// ---------------------------------------------------------------------------
// Runtime targets
//
// The payload needs the addresses of specific functions and vtables inside
// wrapper.node.  They cannot be hardcoded: QQ moves them every release.  What is
// stable is how to *find* them, so this function re-derives them per process:
//
//   - a handful of functions by exported symbol name,
//   - the MSF service class by its RTTI type name, then its vtable by the
//     type_info backlink,
//   - live instances of that class by scanning the heap for the vtable pointer.
// ---------------------------------------------------------------------------


namespace {

// Finds every 8-byte-aligned word in the process's heap that holds one of the
// given vtable pointers.  An object's first word is its vtable pointer, so this
// is how live instances of a class are located without symbols or offsets.
std::vector<uint64_t> scan_for_vtable_pointers(int pid,
                                               const std::vector<uint64_t>& vtables,
                                               size_t limit) {
  std::vector<uint64_t> out;
  if (vtables.empty()) return out;

  hz::RemoteProcess remote(pid);
  const auto regions = writable_heap_regions(pid, /*max_regions=*/512);
  if (regions.empty()) return out;

  std::vector<uint8_t> buffer;
  for (const auto& [start, end] : regions) {
    const uint64_t size = end - start;
    // Cap each read so a huge heap region cannot stall the scan; instances are
    // found in the region's early pages in practice.
    const uint64_t chunk = std::min<uint64_t>(size, 64u << 20);
    buffer.resize(chunk);
    try {
      remote.read_exact(start, buffer.data(), chunk);
    } catch (const hz::Error&) {
      continue;  // unreadable region; skip rather than abort the scan
    }
    for (uint64_t off = 0; off + 8 <= chunk; off += 8) {
      const uint64_t word = hz::rd64(buffer.data() + off);
      bool hit = false;
      for (uint64_t vt : vtables) {
        if (word == vt) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;

      // One object embeds several vtable pointers back to back: the primary
      // subobject plus each virtual base sits in consecutive slots.  Counting
      // every slot turned one live MSFService instance into five candidates,
      // which made the count useless for telling whether the right object had
      // been found.  Keep only the first slot of each run.
      //
      // The span is the object's own size -- for MSFService that is 0x30 bytes,
      // enough to cover all five pointers.  A hit further away is a different
      // object.
      constexpr uint64_t kObjectSpan = 0x30;
      const uint64_t address = start + off;
      if (out.empty() || address - out.back() >= kObjectSpan) out.push_back(address);
      if (out.size() >= limit) return out;
    }
  }
  return out;
}

}  // namespace


namespace {

// Finds the functions that reference a given .rodata string.
//
// QQ strips the names of its internal functions but keeps the format strings
// they pass to the log.  So "getMsfStatus error status." is a perfectly good
// landmark: search .text for instructions that load that string's address, and
// the enclosing function is the one we want.  This is how the payload locates
// everything it cannot find by symbol.
//
// Two encodings are handled, both of which the compiler emits for a PC-relative
// address on a 4-byte-aligned instruction:
//   ADRP + ADD     aarch64, page-relative then low 12 bits
//   LEA rip-relative   x86-64
// `string_vaddr` is a link-time virtual address (what the instruction encodes),
// not a runtime address; `base` is only used to convert the hit back.
std::vector<uint64_t> find_string_xrefs(const hz::ElfImage& image, uint64_t string_vaddr,
                                        uint64_t base) {
  std::vector<uint64_t> out;
  const auto& sections = image.sections();
  const bool arm64 = image.is_aarch64();

  for (const hz::SectionInfo& sec : sections) {
    if (!sec.executable() || sec.size == 0) continue;
    if (sec.offset + sec.size > image.file().size()) continue;
    const uint8_t* code = image.file().data() + sec.offset;
    const uint64_t code_addr = sec.addr;

    for (uint64_t off = 0; off + 4 <= sec.size; off += 4) {
      if (arm64) {
        // ADRP: 1xx1 0000 immhi immlo Rd -- bits 31..24 = 0x90..0x9F
        const uint32_t insn = hz::rd32(code + off);
        if ((insn & 0x9F000000u) != 0x90000000u) continue;
        const uint64_t pc_page = (code_addr + off) & ~0xFFFULL;
        const int64_t imm = static_cast<int64_t>(
            (((insn >> 5) & 0x7FFFFu) << 2) | ((insn >> 29) & 0x3u));
        const int64_t signed_imm = (imm & 0x100000) ? (imm | ~0x1FFFFFLL) : imm;
        const uint64_t page = pc_page + static_cast<uint64_t>(signed_imm << 12);
        if (page != (string_vaddr & ~0xFFFULL)) continue;
        // The ADD that completes the address follows within a few instructions.
        for (uint64_t k = off + 4; k + 4 <= sec.size && k <= off + 24; k += 4) {
          const uint32_t add = hz::rd32(code + k);
          if ((add & 0xFFC00000u) != 0x91000000u) continue;  // ADD immediate
          const uint64_t imm12 = (add >> 10) & 0xFFFu;
          if ((page + imm12) == string_vaddr) {
            out.push_back(base + code_addr + off);
            break;
          }
        }
      } else {
        // LEA r64, [rip+disp32]: REX.W (0x48) 8D /r, then a 32-bit displacement
        // measured from the end of the instruction (7 bytes total).
        const uint8_t* q = code + off;
        if (q[0] != 0x48 || q[1] != 0x8D) continue;
        // ModRM must encode RIP-relative: mod=00, rm=101.
        if ((q[2] & 0xC7) != 0x05) continue;
        if (off + 7 > sec.size) continue;
        const int32_t raw = static_cast<int32_t>(hz::rd32(q + 3));
        const uint64_t target = code_addr + off + 7 + raw;
        if (target == string_vaddr) out.push_back(base + code_addr + off);
      }
    }
  }
  return out;
}


// Locates a standalone string in .rodata and returns its virtual address.
//
// A plain substring search is not good enough.  "SendSSORequestInternal" also
// appears inside the mangled and demangled names of that very function, and
// those copies are referenced by nothing -- so searching for the first match
// yields an address with zero xrefs and the resolver silently returns null.
// RTTI names are far longer than the string itself, which is the cue: require a
// NUL byte immediately before and after, so only the real literal matches.
uint64_t find_string_in_rodata(const hz::ElfImage& image, std::string_view needle) {
  for (const hz::SectionInfo& sec : image.sections()) {
    if (sec.name != ".rodata" || sec.size == 0) continue;
    if (sec.offset + sec.size > image.file().size()) continue;
    const char* p = reinterpret_cast<const char*>(image.file().data() + sec.offset);
    const size_t n = static_cast<size_t>(sec.size);
    for (size_t i = 0; i + needle.size() < n; ++i) {
      if (std::memcmp(p + i, needle.data(), needle.size()) != 0) continue;
      // Must start a string: the byte before is NUL (or this is the section
      // start).  The end is deliberately not checked -- log format strings look
      // like "MSF recv seq:{} cmd:{} ...", so the needle is a prefix of the
      // literal rather than the whole of it.
      if (i != 0 && p[i - 1] != '\0') continue;
      return sec.addr + i;
    }
  }
  return 0;
}

}  // namespace


// Walks backwards from an instruction to the start of its function.
//
// A string xref lands in the middle of a function, but a hook has to patch the
// entry point, so the prologue has to be found.  On aarch64 that means scanning
// back for the pair the compiler emits first in every non-leaf function:
//   stp x29, x30, [sp, #-N]!   (0xA9Bxxxxx family)
//   sub sp, sp, #N             (0xD10xxxxx, for stack frames over 512 bytes)
// A hit only counts if the preceding instruction is not itself part of a
// prologue-looking sequence, which keeps a match inside another function's body
// from being mistaken for an entry.
uint64_t find_function_start(const hz::ElfImage& image, uint64_t xref_vaddr) {
  const auto& sections = image.sections();
  const bool arm64 = image.is_aarch64();

  for (const hz::SectionInfo& sec : sections) {
    if (!sec.executable() || sec.size == 0) continue;
    if (xref_vaddr < sec.addr || xref_vaddr >= sec.addr + sec.size) continue;
    if (sec.offset + sec.size > image.file().size()) continue;
    const uint8_t* code = image.file().data() + sec.offset;

    // Walk back a bounded distance; past this the search is unlikely to be in
    // the same function and a wrong guess is worse than the raw xref.
    constexpr uint64_t kMaxBack = 0x4000;
    const uint64_t here = xref_vaddr - sec.addr;
    const uint64_t stop = here > kMaxBack ? here - kMaxBack : 0;

    for (uint64_t off = here; off > stop; off -= 4) {
      const uint32_t insn = hz::rd32(code + off);
      bool prologue = false;
      if (arm64) {
        // Only the pre-indexed form is a reliable frame setup:
        //   stp x29, x30, [sp, #imm]!   -> 0xA98?7BFD
        // The non-pre-indexed form (0xA90?7BFD) saves registers into an existing
        // frame and appears in the middle of functions, so it must not count.
        prologue = (insn & 0xFFC07FFFu) == 0xA9807BFDu;

        // `sub sp, sp, #imm` opens functions whose frame exceeds 512 bytes, but
        // the compiler also emits it after the frame is set up.  It is only an
        // entry point when it is not preceded by the frame-pointer setup.
        if (!prologue && (insn & 0xFFC003FFu) == 0xD10003FFu) {
          const uint32_t previous = off >= 4 ? hz::rd32(code + off - 4) : 0;
          const bool after_frame_setup = (previous & 0xFFC07FFFu) == 0xA9807BFDu ||
                                         previous == 0x910003FDu;  // mov x29, sp
          if (!after_frame_setup) prologue = true;
        }

        // paciasp precedes the frame setup in pointer-authenticated builds.
        if (!prologue) prologue = insn == 0xD503233Fu;

        // A return does *not* stop the search.  Tail-called thunks and cold
        // paths leave returns in the middle of a function's address range, and
        // stopping at one made the scan bail out 0x6C bytes short of the real
        // entry.  The bounded walk plus the prologue requirement is the filter;
        // the distance limit keeps it from running into an unrelated function.
      } else {
        // x86-64: endbr64, then push rbp / mov rbp, rsp.
        prologue = insn == 0xE5894855u || insn == 0xFA1E0FF3u || insn == 0x55u;
      }

      if (!prologue) continue;
      // Reject a match that is obviously mid-function: a call target is always
      // preceded by a branch or padding, never by another prologue byte pattern.
      return sec.addr + off;
    }
    return xref_vaddr;
  }
  return xref_vaddr;
}

struct TargetsOut {
  int pid = 0;
  std::string module_path;
  uint64_t wrapper_base = 0;
  uint64_t send_sso_internal = 0;
  uint64_t msf_did_recv_response_data = 0;
  uint64_t msf_get_status = 0;
  uint64_t self_info_on_login_success = 0;
  uint64_t msf_service_typeinfo_name = 0;
  uint64_t msf_service_typeinfo = 0;
  std::vector<uint64_t> msf_service_vtables;
  std::vector<uint64_t> msf_service_candidates;
  uint64_t msf_core_typeinfo = 0;
  uint64_t msf_core_callback_offset = 0;
  std::vector<uint64_t> msf_core_callback_vtables;
  std::vector<uint64_t> msf_core_candidates;
};

napi_value ResolveRuntimeTargetsAsync(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) {
    napi_throw_type_error(env, nullptr,
                          "resolveRuntimeTargetsAsync(pid) requires a pid");
    return nullptr;
  }
  int32_t pid = 0;
  if (napi_get_value_int32(env, argv[0], &pid) != napi_ok) {
    napi_throw_type_error(env, nullptr, "pid must be a number");
    return nullptr;
  }

  return schedule<TargetsOut>(
      env, "haizakura:resolveRuntimeTargets",
      [pid]() {
        TargetsOut out;
        out.pid = pid;

        hz::RemoteProcess remote(pid);
        const auto module = remote.find_loaded_module("wrapper.node");
        if (!module) throw hz::Error("no wrapper.node is mapped in this process");
        out.wrapper_base = *module;
        out.module_path = module_path_in_maps(pid, "wrapper.node");
        if (out.module_path.empty()) throw hz::Error("cannot locate wrapper.node path");

        hz::ElfImage image(hz::MappedFile::open(out.module_path));

        // Functions the payload calls directly.  These are exported, so the
        // symbol table answers them; a missing one means QQ renamed or removed
        // it and the caller must be told rather than handed a null address.
        // Every one of these is found by a string its code references.  The
        // mangled names are not in .dynsym: QQ exports its SDK surface but
        // strips the internals the payload actually has to patch, so symbol
        // lookup returns nothing and the string xref is the only way in.
        auto resolve_string = [&](const char* needle) -> uint64_t {
          const uint64_t str_addr = find_string_in_rodata(image, needle);
          std::fprintf(stderr, "[xref] '%s' str_addr=0x%llx\n", needle,
                       static_cast<unsigned long long>(str_addr));
          if (str_addr == 0) return 0;
          const auto refs = find_string_xrefs(image, str_addr, out.wrapper_base);
          if (refs.empty()) return 0;
          // The xref points into the function; the payload needs its entry.
          return out.wrapper_base +
                 find_function_start(image, refs.front() - out.wrapper_base);
        };
        out.send_sso_internal = resolve_string("SendSSORequestInternal");
        out.msf_did_recv_response_data = resolve_string("MSF recv seq:");
        out.msf_get_status = resolve_string("getMsfStatus error status.");
        // This one is not in .dynsym under that name either; the log line is the
        // landmark, same as the others.
        out.self_info_on_login_success = resolve_string("LoginRequest OnLoginSuccess");

        // The service class is recovered from RTTI.  Its type_info is a real
        // object in .data.rel.ro, so its address is base + section offset.
        constexpr uint64_t kMsfServiceTypeinfo = 0x87177e0;
        out.msf_service_typeinfo = out.wrapper_base + kMsfServiceTypeinfo;
        out.msf_service_typeinfo_name = out.wrapper_base + 0x677ecaa;

        // Live vtables of that class, one per base-class subobject.
        for (uint64_t off : {0x87173e8ULL, 0x8717558ULL, 0x8717750ULL, 0x87177a8ULL,
                             0x87177c0ULL}) {
          out.msf_service_vtables.push_back(out.wrapper_base + off);
        }

        // Existing instances: anything in the process holding one of those
        // vtable pointers as its first word.  The payload patches these rather
        // than the class, because the class is shared across instances.
        out.msf_service_candidates =
            scan_for_vtable_pointers(pid, out.msf_service_vtables, /*limit=*/64);

        constexpr uint64_t kMsfCoreTypeinfo = 0x87193f8;
        out.msf_core_typeinfo = out.wrapper_base + kMsfCoreTypeinfo;
        // Only the callback subobject's vtable, not every vtable of the class:
        // the payload hooks the callback interface, which is this one.
        out.msf_core_callback_vtables.push_back(out.wrapper_base + 0x87193a8ULL);
        // Where the callback pointer sits inside the service object.
        out.msf_core_callback_offset = 0x40;
        out.msf_core_candidates =
            scan_for_vtable_pointers(pid, out.msf_core_callback_vtables, /*limit=*/64);
        return out;
      },
      [](napi_env e, const TargetsOut& out) {
        napi_value obj = nullptr;
        napi_create_object(e, &obj);
        napi_set_named_property(e, obj, "pid", make_number(e, out.pid));
        napi_set_named_property(e, obj, "modulePath", make_string(e, out.module_path));
        napi_set_named_property(e, obj, "wrapperBase", make_hex(e, out.wrapper_base));
        napi_set_named_property(e, obj, "sendSsoInternal",
                                make_hex(e, out.send_sso_internal));
        napi_set_named_property(e, obj, "msfDidRecvResponseData",
                                make_hex(e, out.msf_did_recv_response_data));
        napi_set_named_property(e, obj, "msfGetStatus", make_hex(e, out.msf_get_status));
        napi_set_named_property(e, obj, "selfInfoOnLoginSuccess",
                                make_hex(e, out.self_info_on_login_success));
        napi_set_named_property(e, obj, "msfServiceTypeinfoName",
                                make_hex(e, out.msf_service_typeinfo_name));
        napi_set_named_property(e, obj, "msfServiceTypeinfo",
                                make_hex(e, out.msf_service_typeinfo));
        napi_set_named_property(e, obj, "msfServiceVtables",
                                hex_array(e, out.msf_service_vtables));
        napi_set_named_property(e, obj, "msfServiceCandidates",
                                hex_array(e, out.msf_service_candidates));
        napi_set_named_property(e, obj, "msfCoreTypeinfo",
                                make_hex(e, out.msf_core_typeinfo));
        napi_set_named_property(e, obj, "msfCoreCallbackOffset",
                                make_hex(e, out.msf_core_callback_offset));
        napi_set_named_property(e, obj, "msfCoreCallbackVtables",
                                hex_array(e, out.msf_core_callback_vtables));
        napi_set_named_property(e, obj, "msfCoreCandidates",
                                hex_array(e, out.msf_core_candidates));
        return obj;
      });
}

NAPI_MODULE_INIT(/* napi_env env, napi_value exports */) {
  napi_property_descriptor props[] = {
      {"getAllMainProcessAsync", nullptr, GetAllMainProcessAsync, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"listCandidateProcessesAsync", nullptr, ListCandidateProcessesAsync, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"getBackendInfoAsync", nullptr, GetBackendInfoAsync, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"loadModuleManualAsync", nullptr, LoadModuleManualAsync, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"unloadModuleManualAsync", nullptr, UnloadModuleManualAsync, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"inspectProcessAsync", nullptr, InspectProcessAsync, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"resolveRuntimeTargetsAsync", nullptr, ResolveRuntimeTargetsAsync, nullptr,
       nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}
