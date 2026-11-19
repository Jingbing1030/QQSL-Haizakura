cmake_minimum_required(VERSION 3.16)
project(haizakura_hook LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

add_compile_options(-Wall -Wextra -Wno-unused-parameter)

# Node-API headers.  Override with -DNODE_INCLUDE_DIR=... for other installs.
if(NOT NODE_INCLUDE_DIR)
  execute_process(
    COMMAND node -p "require('path').join(process.execPath,'..','..','include','node')"
    OUTPUT_VARIABLE NODE_INCLUDE_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
  )
endif()
if(NOT EXISTS "${NODE_INCLUDE_DIR}/node_api.h")
  message(FATAL_ERROR "node_api.h not found; pass -DNODE_INCLUDE_DIR=/path/to/include/node")
endif()
message(STATUS "Node headers: ${NODE_INCLUDE_DIR}")

add_library(haizakura_hook MODULE
  src/common.cc
  src/compat_isoc23.cc
  src/addon.cc
  src/process_enumerate.cc
  src/elf_image.cc
  src/remote.cc
  src/injector.cc
  src/manual_loader.cc
  src/vtable_hook.cc
  src/vtable_hook_remote.cc
)

target_include_directories(haizakura_hook PRIVATE
  ${NODE_INCLUDE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# The addon resolves Node-API symbols from the host process at load time, so they
# stay undefined at link time and are bound by the loader.  NAPI_MODULE_INIT must
# remain default-visible or require() cannot find the entry point.
target_link_options(haizakura_hook PRIVATE
  -Wl,--unresolved-symbols=ignore-all
  -Wl,--export-dynamic-symbol=napi_register_module_v1
  -Wl,--export-dynamic-symbol=node_api_module_get_api_version_v1
  # Link libstdc++/libgcc statically.  The host application is loaded by whatever
  # libstdc++ the target environment ships, and a container image built on an older
  # base (Debian bookworm ships GLIBCXX_3.4.30) cannot satisfy a symbol set produced
  # against a newer one.  Static linkage removes the dependency entirely.
  -static-libstdc++
  -static-libgcc)
set_target_properties(haizakura_hook PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "haizakura-hook-${ARCH_TAG}"
)

# --- injection test rig -----------------------------------------------------
# fake-target maps a file called wrapper.node so the process picker finds it, and
# loads fake-wrapper.so which provides the symbols the payload resolves against.
add_library(fake_wrapper SHARED test/fake_wrapper.cc)
set_target_properties(fake_wrapper PROPERTIES PREFIX "" SUFFIX ".node" OUTPUT_NAME "fake-wrapper")

# payload.cc is plain C++ with no STL; the hook engine (payload_hook.cc plus the vtable
# machinery it drives) is C++ with STL.  They are separate translation units because they
# have different constraints -- see the comment at the top of payload_hook.cc -- and they
# meet only through the C interface in payload_hook.h.
#
# The engine files are listed here for the first time.  Until now the payload could bind a
# socket and speak the protocol but could not install a single hook, so the login signal it
# reported was a test entry point rather than something QQ actually produced.
add_library(payload SHARED
  test/payload.cc
  src/payload_hook.cc
  src/vtable_hook.cc
  src/slot_relay.cc
  src/elf_image.cc
  src/common.cc
)
set_target_properties(payload PROPERTIES PREFIX "" SUFFIX ".so" OUTPUT_NAME "payload")
target_include_directories(payload PRIVATE include)
target_link_options(payload PRIVATE -Wl,--unresolved-symbols=ignore-all)
# The manual loader implements no TLS relocations, so the payload must not carry
# any.  A stack-protector canary is a thread-local on modern glibc: without
# -fno-stack-protector every non-trivial function in payload.cc fails relocation
# with "manual ELF loader does not implement TLS relocations", which reads like a
# loader bug but is really a payload build flag.
# -fno-exceptions and -fno-rtti apply to payload.cc only, not to the target as a whole.
#
# The engine needs exceptions: it reports malformed ELF and unresolvable symbols by throwing,
# and rewriting that contract to error codes would touch every call site for no gain. It also
# needs RTTI-free compilation to be *off* for its type_info parsing to compile as written.
#
# The reason these flags existed at all is TLS, not philosophy: the loader implements no TLS
# relocations, and a stack-protector canary is a thread-local on modern glibc. Measured, the
# engine adds zero TLS relocations even with exceptions on, because -fno-stack-protector is
# what actually controls the canary -- so the two concerns are separable and are separated
# here rather than compromising one of them.
target_compile_options(payload PRIVATE -fno-stack-protector)
set_source_files_properties(test/payload.cc PROPERTIES COMPILE_OPTIONS "-fno-exceptions;-fno-rtti")

add_executable(fake_target test/fake_target.cc)

# Isolates ptrace remote execution from the ELF loader: writes a hand-assembled
# stub into the target and calls it.  If this passes, the transport is sound.
add_executable(remote_exec_probe test/remote_exec_probe.cc
  src/common.cc src/remote.cc)

# Reports the build ID, layout and exported symbols of an installed wrapper.node.
# Standalone: reads the file, never touches a process, so it is safe to run against
# a live QQ install when working out why a hook stopped loading.
target_include_directories(remote_exec_probe PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

add_executable(hook_target_probe test/hook_target_probe.cc src/common.cc)
target_include_directories(hook_target_probe PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Answers "will the current payload still find its targets in this wrapper.node?"
# by comparing the payload's anchor strings against the target's .rodata.  Reads
# files only, so it is safe to run while QQ is live.
add_executable(hook_compat test/hook_compat.cc src/common.cc)
target_include_directories(hook_compat PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

# Enumerates every vtable in a target module with the class it belongs to, so two
# builds can be diffed when a hook stops matching.
add_executable(hook_vtable_list test/hook_vtable_list.cc src/common.cc)
target_include_directories(hook_vtable_list PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

enable_testing()
add_executable(hook_selftest test/selftest.cc
  src/common.cc
  src/process_enumerate.cc
  src/elf_image.cc
  src/remote.cc
  src/injector.cc
  src/manual_loader.cc
)
target_include_directories(hook_selftest PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# End-to-end injection test.  Needs a live target, so it is not part of the
# default selftest: it forks its own multithreaded fake_target as an orphan and
# injects into that.  Invoked by ctest through the wrapper script, which stages
# the built payload/binary into a scratch directory.
add_executable(thread_inject_test test/thread_inject_test.cc
  src/common.cc
  src/remote.cc
  src/elf_image.cc
  src/manual_loader.cc
)
target_include_directories(thread_inject_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
add_dependencies(thread_inject_test payload fake_wrapper fake_target)

# Contended-attach test.  ptrace attachment is per-thread, so a thread stuck under
# a tracer that never detached spoils that thread only -- and the old SEIZE(pid)
# died with EPERM whenever the stuck thread happened to be the group leader.
# This test parks an independent process on chosen threads of a multithreaded
# target and requires the injector to attach and work anyway.  Needs a live
# target, so like thread_inject_test it is driven by ctest, not by selftest.
add_executable(thread_contend_test test/thread_contend_test.cc
  src/common.cc
  src/remote.cc
)
target_include_directories(thread_contend_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
add_dependencies(thread_contend_test fake_wrapper fake_target)

# A payload whose start_dynamic never returns.  It exists so the call timeout and
# the "no tracer left behind" guarantee are exercised by a real stuck callee
# rather than by reasoning about one.
add_library(payload_hang SHARED test/payload_hang.cc)
set_target_properties(payload_hang PROPERTIES PREFIX "" SUFFIX ".so" OUTPUT_NAME "payload-hang")
target_compile_options(payload_hang PRIVATE -fno-stack-protector -fno-exceptions -fno-rtti)

# Register the end-to-end injection test with CTest so `ctest` is not a no-op.
# It is written as a wrapper script because the test needs a staged directory, an
# orphaned multithreaded target and a yama-allowed tracer -- none of which fit in
# a bare add_test() command line.
configure_file(run_inject_test.sh.in ${CMAKE_CURRENT_BINARY_DIR}/run_inject_test.sh @ONLY)
add_test(NAME thread_inject
         COMMAND ${CMAKE_COMMAND} -E env
                 ${CMAKE_CURRENT_BINARY_DIR}/run_inject_test.sh)
set_tests_properties(thread_inject PROPERTIES TIMEOUT 300)

configure_file(run_contend_test.sh.in ${CMAKE_CURRENT_BINARY_DIR}/run_contend_test.sh @ONLY)
add_test(NAME thread_contend
         COMMAND ${CMAKE_COMMAND} -E env
                 ${CMAKE_CURRENT_BINARY_DIR}/run_contend_test.sh)
set_tests_properties(thread_contend PROPERTIES TIMEOUT 300)

# Vtable discovery against a real wrapper.node.  Takes the path as an argument so
# it runs against whichever QQ build is installed rather than a checked-in blob.
add_executable(vtable_hook_test test/vtable_hook_test.cc
  src/common.cc
  src/elf_image.cc
  src/remote.cc
  src/slot_relay.cc
  src/vtable_hook.cc
  src/vtable_hook_remote.cc
)
target_include_directories(vtable_hook_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# The relay's register save/restore, exercising every calling shape a vtable slot can
# have.  A relay that only handles the integer cases passes a naive test and then
# corrupts a float argument in the target, so the coverage here is the point.
add_executable(slot_relay_test test/slot_relay_test.cc
  src/slot_relay.cc
  src/common.cc
)
target_include_directories(slot_relay_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
add_test(NAME slot_relay COMMAND slot_relay_test)

# End-to-end vtable hooking: needs a live target with the subject library mapped, so it is
# driven by run_vtable_e2e.sh.in rather than by ctest directly.
add_executable(vtable_hook_e2e_test test/vtable_hook_e2e_test.cc
  src/common.cc
  src/elf_image.cc
  src/remote.cc
  src/slot_relay.cc
  src/vtable_hook.cc
  src/vtable_hook_remote.cc
  src/manual_loader.cc
)
target_include_directories(vtable_hook_e2e_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# T10: the recv channel delivers a frame the Node side can parse, and an emit with no peer is
# dropped rather than blocked -- the property that keeps QQ alive when the Node side is not
# attached.  Needs a live target, so it is run by hand against one.
add_executable(recv_channel_test test/recv_channel_test.cc
  src/common.cc
  src/elf_image.cc
  src/remote.cc
  src/manual_loader.cc
)
target_include_directories(recv_channel_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

add_executable(dual_channel_lifecycle_test test/dual_channel_lifecycle_test.cc
  src/common.cc
  src/elf_image.cc
  src/remote.cc
  src/manual_loader.cc
)
target_include_directories(dual_channel_lifecycle_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# The in-process hook path, which is the one the payload uses.  Runs as a single process, so
# ctest can drive it directly.
add_executable(vtable_inproc_test test/vtable_inproc_test.cc
  src/common.cc
  src/elf_image.cc
  src/remote.cc
  src/slot_relay.cc
  src/vtable_hook.cc
  src/vtable_hook_remote.cc
)
target_include_directories(vtable_inproc_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
add_test(NAME vtable_inproc COMMAND vtable_inproc_test)

add_executable(login_state_test test/login_state_test.cc
  src/common.cc
  src/elf_image.cc
  src/remote.cc
  src/manual_loader.cc
)
target_include_directories(login_state_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# The full stack through the real Node addon: loadModuleManualAsync -> start_dynamic ->
# sockets -> client handshake -> unload -> repeat.  Needs a live target pid and Node, so it is
# scripted rather than added to ctest; run test/run_full_stack.sh to drive it.

# Static pre-flight: every relocation type in the payload must be one the loader implements.
# Runs on any host for either architecture's payload, so CI can gate it without a target.
add_executable(reloc_check test/reloc_check.cc
  src/common.cc
  src/elf_image.cc
)
target_include_directories(reloc_check PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
add_test(NAME reloc_check COMMAND reloc_check ${CMAKE_CURRENT_SOURCE_DIR}/test/no_such_file.so)
set_tests_properties(reloc_check PROPERTIES DISABLED TRUE)

# resolveRuntimeTargetsAsync's field values against the recorded ground truth.  Takes the
# wrapper.node as an argument rather than a pid, so it runs anywhere the file is available and
# on either architecture -- the addon itself needs a live QQ on the matching architecture.
add_executable(runtime_targets_test test/runtime_targets_test.cc
  src/common.cc
  src/elf_image.cc
  src/remote.cc
  src/slot_relay.cc
  src/vtable_hook.cc
  src/vtable_hook_remote.cc
)
target_include_directories(runtime_targets_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
