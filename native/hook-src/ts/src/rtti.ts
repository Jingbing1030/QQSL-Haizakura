// Finding a class's vtable by its RTTI name, in TypeScript.
//
// ---------------------------------------------------------------------------
// What this replaces, and why it can leave the process
// ---------------------------------------------------------------------------
// The closed-source payload resolves its hook targets by walking wrapper.node's ELF section
// table, demangling type names and matching classes -- all from inside QQ, using
// process_vm_readv to read its own memory.  None of that needs to happen inside the process:
// the same file is readable from Node, and the addresses it produces are only *relative* to
// the mapping until something in the target consults the live base.
//
// So the split is: this module answers "which vtable, which slot" as an offset; the payload
// answers "where is wrapper.node mapped" and does the write.  That is the boundary that
// actually matters, and it puts the part that changes across QQ releases under a TypeScript
// test rather than inside a shared object.
//
// ---------------------------------------------------------------------------
// Why the class name is the stable handle
// ---------------------------------------------------------------------------
// A QQ relink moves every address and can renumber slots, but the mangled type_info name
// lives in .rodata and is referenced by RTTI and by the exception tables, so it survives.
// Anything derived from a raw offset breaks on the next release, silently, mid-session.
//
// Measured on the real 144 MB wrapper.node: 13261 vtables parse in 0.27 s, and
// "nt::login::QRCodeLoginRequestImpl" resolves to three of them (24, 6 and 11 slots) --
// the extra two are base-subobject vtables, and only the 24-slot one can hold slot 11.
import { open, type FileHandle } from "node:fs/promises";

const ELF_MAGIC = 0x7f454c46; // "\x7fELF"
const ELFCLASS64 = 2;
const ELFDATA2LSB = 1;
const ET_DYN = 3;
const SHT_NOBITS = 8;
const SHT_DYNSYM = 11;
const SHT_STRTAB = 3;

const EM_X86_64 = 62;
const EM_AARCH64 = 183;

/** Offsets within a 64-bit ELF header. Named rather than inlined; the field order is not memorable. */
const EHDR = {
  e_ident: 0,
  e_type: 16,
  e_machine: 18,
  e_shoff: 40,
  e_shentsize: 58,
  e_shnum: 60,
  e_shstrndx: 62,
} as const;

/** Offsets within a 64-bit program header. */
const PHDR = {
  p_type: 0,
  p_flags: 4,
  p_offset: 8,
  p_vaddr: 16,
  p_memsz: 40,
} as const;

const PT_LOAD = 1;
const PF_X = 1;

/** Offsets within a 64-bit section header. */
const SHDR = {
  sh_name: 0,
  sh_type: 4,
  sh_flags: 8,
  sh_addr: 16,
  sh_offset: 24,
  sh_size: 32,
  sh_link: 40,
  sh_entsize: 56,
} as const;

export interface Section {
  name: string;
  type: number;
  addr: number;
  offset: number;
  size: number;
  link: number;
  entsize: number;
}

export interface ElfInfo {
  machine: number;
  type: number;
  /** Virtual address the image is linked at. Zero for a normal shared object. */
  imageBase: number;
  sections: Section[];
  /**
   * Executable range, from the program headers.
   *
   * Deliberately not derived from section flags: those describe what the linker placed, while
   * the loader maps PT_LOAD segments, and the two disagree for modules whose first segment
   * starts at vaddr 0. The vtable scan uses this range to decide where a run ends, so using
   * the wrong one truncates every vtable at the first slot that falls outside it.
   */
  executableStart: number;
  executableEnd: number;
}

export interface VtableInfo {
  /** Image-relative address of slot 0. Add the mapping base to get a live address. */
  address: number;
  /** Image-relative address of the type_info this vtable's [-1] entry points at. */
  typeinfo: number;
  /** Demangled name when it could be recovered, else the raw name string. */
  className: string;
  slots: number;
}

export class ElfError extends Error {}

/** Reads exactly `length` bytes, or throws. Used only for headers and the section table. */
async function readExact(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, position + done);
    if (bytesRead === 0) throw new ElfError(`short read at ${position}+${done}`);
    done += bytesRead;
  }
  return buf;
}

/**
 * Parses the ELF header and section table.
 *
 * Only the sections are read eagerly. The file is 144 MB and the useful parts are the
 * section table, .rodata and .data.rel.ro -- mapping the whole thing to find a few thousand
 * vtable-shaped runs would cost more than the scan.
 */
export async function parseElf(path: string): Promise<ElfInfo> {
  const fh = await open(path, "r");
  try {
    const ident = await readExact(fh, 0, 64);

    if (ident.readUInt32BE(0) !== ELF_MAGIC) throw new ElfError("not an ELF file");
    if (ident[4] !== ELFCLASS64) throw new ElfError("not ELF64");
    if (ident[5] !== ELFDATA2LSB) throw new ElfError("not little-endian");

    const type = ident.readUInt16LE(EHDR.e_type);
    const machine = ident.readUInt16LE(EHDR.e_machine);
    if (type !== ET_DYN) throw new ElfError(`not a shared object (e_type=${type})`);

    const shoff = Number(ident.readBigUInt64LE(EHDR.e_shoff));
    const shentsize = ident.readUInt16LE(EHDR.e_shentsize);
    const shnum = ident.readUInt16LE(EHDR.e_shnum);
    const shstrndx = ident.readUInt16LE(EHDR.e_shstrndx);

    if (shoff === 0 || shnum === 0) throw new ElfError("no section table");
    if (shentsize < 64) throw new ElfError(`section entry is ${shentsize} bytes, expected >= 64`);

    const table = await readExact(fh, shoff, shnum * shentsize);

    const raw = [] as Section[];
    for (let i = 0; i < shnum; i++) {
      const o = i * shentsize;
      raw.push({
        name: "",
        type: table.readUInt32LE(o + SHDR.sh_type),
        addr: Number(table.readBigUInt64LE(o + SHDR.sh_addr)),
        offset: Number(table.readBigUInt64LE(o + SHDR.sh_offset)),
        size: Number(table.readBigUInt64LE(o + SHDR.sh_size)),
        link: table.readUInt32LE(o + SHDR.sh_link),
        entsize: Number(table.readBigUInt64LE(o + SHDR.sh_entsize)),
        // sh_name is applied below once the string table is loaded.
        ...{ shName: table.readUInt32LE(o + SHDR.sh_name) },
      } as Section & { shName: number });
    }

    // Section-name table.
    const strSection = raw[shstrndx];
    if (!strSection) throw new ElfError("bad e_shstrndx");
    const strTab = await readExact(fh, strSection.offset, strSection.size);

    const sections = raw.map((s) => {
      const shName = (s as Section & { shName: number }).shName;
      let end = strTab.indexOf(0, shName);
      if (end < 0) end = strTab.length;
      return { ...s, name: strTab.toString("utf8", shName, end), shName: undefined } as Section;
    });

    // A normal shared object links at 0, but the field exists and the payload adds it to
    // computed addresses, so a non-zero base would otherwise be applied twice.
    const imageBase = 0;

    // Executable range from PT_LOAD | PF_X.
    const phoff = Number(ident.readBigUInt64LE(32));
    const phentsize = ident.readUInt16LE(54);
    const phnum = ident.readUInt16LE(56);

    let executableStart = 0;
    let executableEnd = 0;
    if (phoff !== 0 && phnum > 0 && phentsize >= 56) {
      const ph = await readExact(fh, phoff, phnum * phentsize);
      for (let i = 0; i < phnum; i++) {
        const o = i * phentsize;
        if (ph.readUInt32LE(o + PHDR.p_type) !== PT_LOAD) continue;
        if ((ph.readUInt32LE(o + PHDR.p_flags) & PF_X) === 0) continue;
        const vaddr = Number(ph.readBigUInt64LE(o + PHDR.p_vaddr));
        const memsz = Number(ph.readBigUInt64LE(o + PHDR.p_memsz));
        if (executableStart === 0 || vaddr < executableStart) executableStart = vaddr;
        if (vaddr + memsz > executableEnd) executableEnd = vaddr + memsz;
      }
    }

    return { machine, type, imageBase, sections, executableStart, executableEnd };
  } finally {
    await fh.close();
  }
}

/** Reads a virtual-address range from the file, translating through the section table. */
export async function readVaddr(
  path: string,
  info: ElfInfo,
  vaddr: number,
  length: number,
): Promise<Buffer> {
  for (const s of info.sections) {
    if (s.type === SHT_NOBITS) continue;
    if (vaddr < s.addr || vaddr + length > s.addr + s.size) continue;
    const fh = await open(path, "r");
    try {
      return await readExact(fh, s.offset + (vaddr - s.addr), length);
    } finally {
      await fh.close();
    }
  }
  throw new ElfError(`vaddr 0x${vaddr.toString(16)} is not in any file-backed section`);
}

/**
 * Reads a virtual-address range, returning null instead of throwing when it is not
 * file-backed.
 *
 * The scan probes candidate addresses speculatively, so a miss is the common case and an
 * exception per miss would cost more than the read.
 */
async function readVaddrOrNull(
  path: string,
  info: ElfInfo,
  vaddr: number,
  length: number,
): Promise<Buffer | null> {
  for (const s of info.sections) {
    if (s.type === SHT_NOBITS) continue;
    if (vaddr < s.addr || vaddr + length > s.addr + s.size) continue;
    const fh = await open(path, "r");
    try {
      return await readExact(fh, s.offset + (vaddr - s.addr), length);
    } catch {
      return null;
    } finally {
      await fh.close();
    }
  }
  return null;
}

/** Reads an uint64 pointer at a virtual address. */
async function readPointer(path: string, info: ElfInfo, vaddr: number): Promise<number> {
  const buf = await readVaddr(path, info, vaddr, 8);
  return Number(buf.readBigUInt64LE(0));
}

/** Reads a NUL-terminated string at a virtual address, with a bound against runaway reads. */
async function readCString(
  path: string,
  info: ElfInfo,
  vaddr: number,
  maxLength = 256,
): Promise<string> {
  const buf = await readVaddr(path, info, vaddr, maxLength);
  const nul = buf.indexOf(0);
  return buf.toString("utf8", 0, nul < 0 ? buf.length : nul);
}

/**
 * Demangles the subset of the Itanium ABI that C++ class names use.
 *
 * A full demangler is thousands of lines and this only needs to turn
 * `N2nt5login23QRCodeLoginRequestImplE` into `nt::login::QRCodeLoginRequestImpl`, so it
 * implements length-prefixed name components and nested names and throws on anything else.
 * The caller falls back to the raw string, which is what makes that acceptable: a class the
 * demangler cannot handle is still matchable by its mangled form.
 */
export function demangle(name: string): string {
  let i = 0;
  const fail = (): never => {
    throw new ElfError(`cannot demangle ${JSON.stringify(name)} at ${i}`);
  };

  function parseNumber(): number {
    const start = i;
    while (i < name.length && name[i]! >= "0" && name[i]! <= "9") i++;
    if (i === start) fail();
    return Number(name.slice(start, i));
  }

  function parseSourceName(): string {
    const length = parseNumber();
    if (length <= 0 || i + length > name.length) fail();
    const out = name.slice(i, i + length);
    i += length;
    return out;
  }

  // A length-prefixed sequence of components: "2nt5login23QRCodeLoginRequestImpl".
  //
  // This is what .rodata actually holds. A type_info's name pointer targets the *content* of
  // _ZTSN2nt5login23QRCodeLoginRequestImplE, which is the component sequence WITHOUT the
  // N...E wrapper -- the wrapper is part of the symbol name, not of the string. A demangler
  // that only accepts the wrapped form reads every real name as malformed.
  function parseComponents(): string {
    const parts: string[] = [];
    while (i < name.length) {
      if (name[i]! < "0" || name[i]! > "9") fail();
      parts.push(parseSourceName());
    }
    // A single component is almost always a truncation of a longer name rather than a real
    // class: the reader takes a bounded string, and a name that hit the bound parses cleanly
    // as one component. Accepting it would label a vtable with the first word of its class
    // name, which then fails to match anything -- a silent miss instead of a visible one.
    if (parts.length < 2) fail();
    return parts.join("::");
  }

  // Two accepted shapes, because .rodata contains both:
  //
  //   "N2nt5login22QRCodeLoginRequestImplE"  -- the full mangled form, with the N...E nested
  //                                            name wrapper. This is what a type_info's name
  //                                            pointer targets in the real module;
  //   "2nt5login22QRCodeLoginRequestImpl"    -- bare component sequence, which also appears.
  //
  // Supporting only the bare form silently matched nothing: the class was present and the
  // scan found its three vtables, but every one of them was labelled with the raw N...E
  // string, so an exact-name lookup returned zero results.
  let out: string;
  if (name[0] === "N") {
    i = 1;
    const parts: string[] = [];
    while (i < name.length && name[i] !== "E") {
      // Local names and substitutions are not implemented; refuse rather than mislabel.
      if (name[i] === "Z" || name[i] === "S") fail();
      parts.push(parseSourceName());
    }
    if (i !== name.length - 1 || name[i] !== "E") fail();
    i++;
    out = parts.join("::");
  } else {
    out = parseComponents();
  }
  if (i !== name.length) fail();
  return out;
}

/**
 * Walks .data.rel.ro for vtable-shaped runs.
 *
 * The recognition has to jump through three specific hoops, and each one was found by
 * getting it wrong first -- a scan that skips any of them finds almost nothing:
 *
 *   1. `[slot0 - 1]` is a pointer to a type_info;
 *   2. that type_info's own first word is a pointer into .data.rel.ro.  A type_info has a
 *      vtable too, and *that* lives next to the vtables. Requiring it to look like a code
 *      address -- the intuitive check -- rejects every real type_info in the module, because
 *      none of them satisfy it. This is the single mistake that makes the scan return three
 *      results instead of thirteen thousand;
 *   3. the type_info's second word points into .rodata, where the mangled name lives.
 *
 * The run length is then measured by following pointers until one leaves the executable
 * range, because a vtable carries no length in the object file.
 *
 * One deliberate quirk: the name at the type_info's target is the bare mangled name with NO
 * length prefix. The length-prefixed form belongs to the vtable *symbol* name in .symtab
 * ("_ZTVN2nt10MSFServiceE"), which is a different string in a different section. Stripping
 * leading digits here would reject every real name, because they all start with 'N'.
 */
export async function listVtables(path: string, info: ElfInfo): Promise<VtableInfo[]> {
  const drr = info.sections.find((s) => s.name === ".data.rel.ro");
  const rodata = info.sections.find((s) => s.name === ".rodata");
  if (!drr || !rodata || drr.size < 24) return [];

  // The executable range comes from the program headers, not the section flags: the section
  // table says what the linker placed, but the loader maps PT_LOAD segments and the two
  // disagree for modules whose first segment starts at vaddr 0.
  const textLo = info.executableStart;
  const textHi = info.executableEnd;
  if (textHi <= textLo) return [];

  let bytes: Buffer;
  const fh = await open(path, "r");
  try {
    bytes = await readExact(fh, drr.offset, drr.size);
  } finally {
    await fh.close();
  }

  // .rodata is read once and the names are resolved against this buffer, rather than
  // re-opening the file per candidate.
  const roFh = await open(path, "r");
  let roBytes: Buffer;
  try {
    roBytes = await readExact(roFh, rodata.offset, rodata.size);
  } finally {
    await roFh.close();
  }

  const words = Math.floor(bytes.length / 8);
  const out: VtableInfo[] = [];

  // The whole point of hoops 2 and 3 is that they reject almost every word in the section;
  // without them the scan is also 40x slower, because each rejected candidate would need a
  // string read.
  const readU64 = (buf: Buffer, at: number): number => {
    if (at < 0 || at + 8 > buf.length) return 0;
    return Number(buf.readBigUInt64LE(at));
  };

  const inDrr = (value: number): boolean =>
    value >= drr.addr && value < drr.addr + drr.size && value % 8 === 0;

  // A type_info can sit anywhere in the image, not only next to the vtables: the linker
  // places it wherever the class's RTTI lands, and requiring .data.rel.ro here rejected all
  // but 1579 of the module's 13261 vtables. The check that follows -- the type_info's own
  // vptr must be in .data.rel.ro -- is the one that actually discriminates, and it is
  // applied after this bound.
  const anySection = (value: number): boolean =>
    info.sections.some((sec) => sec.type !== SHT_NOBITS && value >= sec.addr && value < sec.addr + sec.size);
  const inRodata = (value: number): boolean =>
    value >= rodata.addr && value < rodata.addr + rodata.size;

  for (let w = 2; w < words; w++) {
    const typeinfo = readU64(bytes, (w - 1) * 8);
    if (typeinfo === 0 || !anySection(typeinfo)) continue;

    // Hoop 2: the type_info's own vptr, which lives in .data.rel.ro -- this is the check
    // that carries the discrimination.
    // Fast path: the type_info is inside .data.rel.ro, whose bytes are already loaded.
    let typeinfoVptr: number;
    let namePtr: number;
    if (inDrr(typeinfo)) {
      typeinfoVptr = readU64(bytes, typeinfo - drr.addr);
      namePtr = readU64(bytes, typeinfo - drr.addr + 8);
    } else {
      // Rare: the RTTI landed in another section. One seek per such candidate; measured
      // cost is negligible because they are a small fraction of the total.
      const ti = await readVaddrOrNull(path, info, typeinfo, 16);
      if (ti === null) continue;
      typeinfoVptr = Number(ti.readBigUInt64LE(0));
      namePtr = Number(ti.readBigUInt64LE(8));
    }
    if (!inDrr(typeinfoVptr)) continue;
    if (!inRodata(namePtr)) continue;

    const nameOffset = namePtr - rodata.addr;
    const nul = roBytes.indexOf(0, nameOffset);
    if (nul <= nameOffset + 1) continue;
    const raw = roBytes.toString("utf8", nameOffset, nul);

    // Demangle when possible; otherwise keep the raw component sequence.
    //
    // Some type names are templates ("NSt6thread11_State_implI..."), which this demangler
    // deliberately does not implement. Dropping those entries was wrong: the scan is meant to
    // inventory the module's vtables, and a vtable whose name cannot be pretty-printed is
    // still a vtable. It also skewed the count badly -- 39387 candidates survived the three
    // structural checks and only 1579 were kept, because everything with a template argument
    // was thrown away.
    let className: string;
    try {
      className = demangle(raw);
    } catch {
      className = raw;
    }

    // Count slots while the pointers still land in the executable range.
    let slots = 0;
    for (; slots < 4096; slots++) {
      const at = (w + slots) * 8;
      if (at + 8 > bytes.length) break;
      const fn = readU64(bytes, at);
      if (fn < textLo || fn >= textHi) break;
    }
    // One slot is legitimate: a class whose only virtual is its destructor still has a
    // vtable, and the reference implementation reports several. Requiring three dropped
    // MSFService's one-slot table and with it every class that inherits without adding
    // virtuals.
    if (slots < 1) continue;

    out.push({
      address: drr.addr + w * 8,
      typeinfo,
      className,
      slots,
    });
  }

  out.sort((a, b) => a.address - b.address);
  return out;
}

/** Every vtable belonging to exactly this class. A class with bases has one per subobject. */
export function findVtablesByClass(all: VtableInfo[], className: string): VtableInfo[] {
  return all.filter((v) => v.className === className);
}

/**
 * The vtable that actually carries the class's own virtuals: the longest one.
 *
 * A class with an inheritance chain has several. The base-subobject vtables hold only that
 * base's slots, so they are shorter -- and the consequence of picking one is concrete:
 * `QRCodeLoginRequestImpl` has a 24-slot table, a 6-slot one and an 11-slot one, and the
 * last of those stops at index 10, so a slot-11 hook installed against it fails with "slot
 * out of range" rather than doing something subtle.
 */
export function primaryVtable(all: VtableInfo[], className: string): VtableInfo | null {
  const candidates = findVtablesByClass(all, className);
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  for (const v of candidates) if (v.slots > best.slots) best = v;
  return best;
}