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
  src/addon.cc
  src/process_enumerate.cc
  src/elf_image.cc
  src/remote.cc
  src/injector.cc
  src/manual_loader.cc
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

add_library(payload SHARED test/payload.cc)
set_target_properties(payload PROPERTIES PREFIX "" SUFFIX ".so" OUTPUT_NAME "payload")
target_link_options(payload PRIVATE -Wl,--unresolved-symbols=ignore-all)

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
