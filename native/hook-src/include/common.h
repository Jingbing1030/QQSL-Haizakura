// Haizakura hook addon — shared types and small utilities.
//
// The addon injects a shared object into a running QQ process and calls one of
// its exports.  Three layers cooperate:
//
//   ProcessEnumerator  find the QQ main process (the one that owns wrapper.node)
//   RemoteProcess      read/write another process's memory, run a syscall there
//   ManualLoader       map an ELF image into that process and resolve its relocs
//
// Everything is synchronous except the top-level N-API entry points, which hand
// the work to libuv so a slow target cannot block the event loop.

#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>
#include <optional>
#include <stdexcept>

namespace hz {

// All failures surface as this so callers can distinguish an expected failure
// (target vanished, permissions) from a bug.
class Error : public std::runtime_error {
 public:
  explicit Error(std::string message) : std::runtime_error(std::move(message)) {}
};

[[noreturn]] void fail(std::string message);

// printf-style helper used all over the error paths.
std::string format(const char* fmt, ...) __attribute__((format(printf, 1, 2)));

bool starts_with(std::string_view s, std::string_view prefix);
bool ends_with(std::string_view s, std::string_view suffix);

// Read a whole file.  Throws Error on failure; `limit` guards against pointing
// at something huge by accident.
std::vector<uint8_t> read_file(const std::string& path, size_t limit = 256u << 20);
std::string read_file_text(const std::string& path, size_t limit = 4u << 20);

// A mapped file kept alive for the lifetime of the object.  ELF parsing works
// on this mapping rather than re-reading with pread() for every field.
class MappedFile {
 public:
  MappedFile() = default;
  ~MappedFile();
  MappedFile(MappedFile&&) noexcept;
  MappedFile& operator=(MappedFile&&) noexcept;
  MappedFile(const MappedFile&) = delete;
  MappedFile& operator=(const MappedFile&) = delete;

  // `require_regular` rejects directories, sockets, etc.  Symlinks are followed
  // first so a path like /proc/<pid>/root/... behaves like the real file.
  static MappedFile open(const std::string& path, bool require_regular = true);

  const uint8_t* data() const { return data_; }
  size_t size() const { return size_; }
  bool valid() const { return data_ != nullptr; }

 private:
  void reset();

  uint8_t* data_ = nullptr;
  size_t size_ = 0;
};

// Little-endian reads.  The loader only accepts ELF64 LE, so host order is
// assumed for the fields but these keep the parsing code honest.
inline uint16_t rd16(const uint8_t* p) {
  return static_cast<uint16_t>(p[0] | (p[1] << 8));
}
inline uint32_t rd32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}
inline uint64_t rd64(const uint8_t* p) {
  return static_cast<uint64_t>(rd32(p)) | (static_cast<uint64_t>(rd32(p + 4)) << 32);
}

}  // namespace hz
