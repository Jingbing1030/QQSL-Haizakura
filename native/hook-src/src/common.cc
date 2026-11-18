#include "common.h"

#include <cerrno>
#include <cstdarg>
#include <cstdio>
#include <climits>
#include <cstring>

#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

namespace hz {

void fail(std::string message) { throw Error(std::move(message)); }

std::string format(const char* fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  va_list ap2;
  va_copy(ap2, ap);
  const int needed = std::vsnprintf(nullptr, 0, fmt, ap);
  va_end(ap);
  if (needed < 0) {
    va_end(ap2);
    return fmt;
  }
  std::string out(static_cast<size_t>(needed), '\0');
  std::vsnprintf(out.data(), out.size() + 1, fmt, ap2);
  va_end(ap2);
  return out;
}

bool starts_with(std::string_view s, std::string_view prefix) {
  return s.size() >= prefix.size() && s.compare(0, prefix.size(), prefix) == 0;
}

bool ends_with(std::string_view s, std::string_view suffix) {
  return s.size() >= suffix.size() &&
         s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

MappedFile::~MappedFile() { reset(); }

MappedFile::MappedFile(MappedFile&& other) noexcept
    : data_(other.data_), size_(other.size_) {
  other.data_ = nullptr;
  other.size_ = 0;
}

MappedFile& MappedFile::operator=(MappedFile&& other) noexcept {
  if (this != &other) {
    reset();
    data_ = other.data_;
    size_ = other.size_;
    other.data_ = nullptr;
    other.size_ = 0;
  }
  return *this;
}

void MappedFile::reset() {
  if (data_ != nullptr) {
    ::munmap(data_, size_);
    data_ = nullptr;
  }
  size_ = 0;
}

MappedFile MappedFile::open(const std::string& path, bool require_regular) {
  // realpath() first: /proc/<pid>/root/... and /proc/<pid>/cwd/... are symlinks,
  // and some container runtimes expose them only through the resolved path.
  char resolved[PATH_MAX];
  const char* target = path.c_str();
  if (::realpath(path.c_str(), resolved) != nullptr) {
    target = resolved;
  }

  const int fd = ::open(target, O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    fail(format("failed to open ELF file %s: %s", target, std::strerror(errno)));
  }

  struct stat st{};
  if (::fstat(fd, &st) != 0) {
    const int saved = errno;
    ::close(fd);
    fail(format("failed to stat %s: %s", target, std::strerror(saved)));
  }

  if (require_regular && !S_ISREG(st.st_mode)) {
    ::close(fd);
    fail(format("mapped ELF file is not a nonempty regular file: %s", target));
  }
  if (require_regular && st.st_size <= 0) {
    ::close(fd);
    fail(format("ELF file is empty: %s", target));
  }

  const size_t size = static_cast<size_t>(st.st_size);
  void* map = ::mmap(nullptr, size, PROT_READ, MAP_PRIVATE, fd, 0);
  const int saved = errno;
  ::close(fd);
  if (map == MAP_FAILED) {
    fail(format("failed to map ELF %s: %s", target, std::strerror(saved)));
  }

  MappedFile out;
  out.data_ = static_cast<uint8_t*>(map);
  out.size_ = size;
  return out;
}

std::vector<uint8_t> read_file(const std::string& path, size_t limit) {
  const int fd = ::open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    fail(format("failed to open %s: %s", path.c_str(), std::strerror(errno)));
  }
  std::vector<uint8_t> data;
  data.resize(64 * 1024);
  size_t used = 0;
  for (;;) {
    if (used == data.size()) {
      if (data.size() >= limit) break;
      data.resize(std::min(limit, data.size() * 2));
    }
    const ssize_t n = ::read(fd, data.data() + used, data.size() - used);
    if (n < 0) {
      if (errno == EINTR) continue;
      const int saved = errno;
      ::close(fd);
      fail(format("failed to read %s: %s", path.c_str(), std::strerror(saved)));
    }
    if (n == 0) break;
    used += static_cast<size_t>(n);
  }
  ::close(fd);
  data.resize(used);
  return data;
}

std::string read_file_text(const std::string& path, size_t limit) {
  const auto bytes = read_file(path, limit);
  return std::string(reinterpret_cast<const char*>(bytes.data()), bytes.size());
}

}  // namespace hz
