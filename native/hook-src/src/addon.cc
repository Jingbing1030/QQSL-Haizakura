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
        return process_list_to_array(e, list);
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
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}
