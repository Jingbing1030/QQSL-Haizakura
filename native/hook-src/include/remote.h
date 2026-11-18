// Cross-process memory access and syscall execution.
//
// The injector needs three things from the target: read its memory (to walk the
// ELF structures already mapped there), write its memory (to place relocated
// bytes and a scratch buffer), and run a syscall in its context (to mmap a range
// for the payload).  All three are built on process_vm_readv/writev and a small
// ptrace-driven syscall trampoline.
//
// process_vm_* requires PTRACE_MODE_ATTACH permission on the target.  When it is
// unavailable (hardened kernels, seccomp, some container runtimes) the same
// transfer is done word-by-word through PTRACE_PEEKDATA/POKEDATA, which is
// slower but works wherever ptrace itself does.

#pragma once

#include "common.h"

#include <optional>
#include <utility>
#include <vector>

namespace hz {

class RemoteProcess {
 public:
  explicit RemoteProcess(int pid);
  ~RemoteProcess();

  RemoteProcess(const RemoteProcess&) = delete;
  RemoteProcess& operator=(const RemoteProcess&) = delete;

  int pid() const { return pid_; }

  // True once we hold ptrace control of the target.
  bool attached() const { return attached_; }

  // Attach and detach.  attach() tries PTRACE_SEIZE first (it does not stop the
  // target), falling back to PTRACE_ATTACH.  detach() always restores the target's
  // registers and resumes it, including on the error path.
  void attach();
  void detach();

  // Memory transfer.  Both return the number of bytes moved and throw when the
  // kernel refuses; callers retry in smaller chunks where a partial read is
  // expected (e.g. reading module memory that is unmapped at the tail).
  size_t read(uint64_t addr, void* out, size_t len);
  size_t write(uint64_t addr, const void* in, size_t len);

  // Convenience wrappers that throw unless the full range transfers.
  void read_exact(uint64_t addr, void* out, size_t len);
  void write_exact(uint64_t addr, const void* in, size_t len);

  template <typename T>
  T read_value(uint64_t addr) {
    T value{};
    read_exact(addr, &value, sizeof(T));
    return value;
  }

  template <typename T>
  void write_value(uint64_t addr, T value) {
    write_exact(addr, &value, sizeof(T));
  }

  // Reads a NUL-terminated string, capped at `max_len` to bound a bad pointer.
  std::string read_cstring(uint64_t addr, size_t max_len = 4096);

  // Runs mmap(len) in the target and returns the mapping address, or 0 when the
  // target's mmap failed.
  uint64_t remote_mmap(uint64_t len, int prot, int flags);
  bool remote_munmap(uint64_t addr, uint64_t len);

  // Executes an arbitrary syscall in the target.  The trampoline stops the
  // tracee, points its instruction pointer at a `syscall` instruction already
  // present in its libc, single-steps once, then restores every register.
  // Returns the raw syscall result (negative errno encoded as uint64_t).
  uint64_t remote_syscall6(uint64_t number, uint64_t a1, uint64_t a2, uint64_t a3,
                           uint64_t a4 = 0, uint64_t a5 = 0, uint64_t a6 = 0);

  // Calls a function inside the target and returns its result.  Implemented by
  // saving the tracee's registers, planting a return address that points at an
  // `int3` in a scratch page, setting up the arguments, and resuming until the
  // breakpoint trips.  `args` are placed in the first `argc` integer registers.
  uint64_t remote_call(uint64_t fn, const std::vector<uint64_t>& args, size_t argc);

  // Finds a mapping whose pathname contains `soname` and returns its lowest base
  // address, or nullopt when the target has not loaded it.
  std::optional<uint64_t> find_loaded_module(std::string_view soname);

  // Executable [start, end) ranges belonging to a module.  Only these may host the
  // syscall trampoline; redirecting execution into a non-executable mapping is an
  // immediate SIGSEGV.
  std::vector<std::pair<uint64_t, uint64_t>> executable_regions_of(
      std::string_view soname);

  // Returns a scratch buffer of at least `size` bytes inside the target, reused
  // across calls so writing many short strings stays cheap.
  uint64_t scratch_buffer(size_t size);
  void release_scratch();

  // Ensures the target is stopped so registers can be inspected or rewritten.
  // PTRACE_SEIZE leaves the tracee running, so the first register access has to
  // interrupt it; afterwards we stay in a stopped state between operations.
  void stop_target();
  void resume_target();

  // True when the target stopped because of a signal we injected rather than one
  // it raised itself.
  bool last_stop_was_ours() const { return last_stop_ours_; }

 private:
  void seize();
  void interrupt();
  void wait_for_stop();
  void restore_and_continue();
  void ensure_syscall_site();

  int pid_ = 0;
  bool attached_ = false;
  bool last_stop_ours_ = false;

  // Saved register state, restored before every resume so the target never
  // observes a modified context.
  struct SavedRegs;
  SavedRegs* saved_ = nullptr;

  uint64_t syscall_site_ = 0;
  bool syscall_site_valid_ = false;

  uint64_t scratch_addr_ = 0;
  size_t scratch_size_ = 0;
};

}  // namespace hz
