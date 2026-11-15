"""从运行中的 Unity 进程内存里 dump 出解密的 .NET 程序集（脱壳）。

原理：磁盘上的 Assembly-CSharp.dll 被厂商加密，但 Mono 加载后内存中是标准 PE 映像。
      扫描目标进程的私有内存区，找 MZ/PE 头 + .NET 元数据签名 BSJB，导出成 .dll。

用法：
    python tools/dump-assembly.py                 # 自动找 HLF10631030.exe
    python tools/dump-assembly.py --pid 1234
    python tools/dump-assembly.py --out C:\\Temp\\dumped
"""
import ctypes
import ctypes.wintypes as wt
import os
import re
import sys
import struct

k32 = ctypes.WinDLL("kernel32", use_last_error=True)

PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
MEM_COMMIT = 0x1000
PAGE_GUARD = 0x100
PAGE_NOACCESS = 0x01
READABLE = (0x02, 0x04, 0x08, 0x20, 0x40, 0x80)  # READONLY / READWRITE / WRITECOPY / EXECUTE_*

class MEMORY_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p),
        ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wt.DWORD),
        ("RegionSize", ctypes.c_size_t),
        ("State", wt.DWORD),
        ("Protect", wt.DWORD),
        ("Type", wt.DWORD),
    ]

k32.OpenProcess.restype = wt.HANDLE
k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.VirtualQueryEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.POINTER(MEMORY_BASIC_INFORMATION), ctypes.c_size_t]
k32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.POINTER(ctypes.c_size_t)]


def find_pid(name="HLF10631030.exe"):
    import subprocess
    out = subprocess.run(["tasklist", "/fo", "csv", "/fi", f"IMAGENAME eq {name}"],
                         capture_output=True, text=True, errors="ignore").stdout
    m = re.search(r'"[^"]+","(\d+)"', out)
    return int(m.group(1)) if m else None


def iter_regions(h):
    addr = 0
    mbi = MEMORY_BASIC_INFORMATION()
    while k32.VirtualQueryEx(h, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)):
        base = mbi.BaseAddress or 0
        size = mbi.RegionSize
        if size == 0:
            break
        if (mbi.State == MEM_COMMIT and mbi.Protect not in (PAGE_NOACCESS,)
                and not (mbi.Protect & PAGE_GUARD) and mbi.Protect & 0xFF in READABLE
                and size <= 64 * 1024 * 1024):
            yield base, size
        addr = base + size


def read(h, base, size):
    buf = ctypes.create_string_buffer(size)
    got = ctypes.c_size_t(0)
    ok = k32.ReadProcessMemory(h, ctypes.c_void_p(base), buf, size, ctypes.byref(got))
    if not ok or got.value == 0:
        return None
    return buf.raw[:got.value]


def is_dotnet_pe(data):
    """MZ + PE + 可选头里存在 CLI 目录 + 元数据 BSJB"""
    if len(data) < 0x200 or data[:2] != b"MZ":
        return False
    try:
        e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    except Exception:
        return False
    if e_lfanew <= 0 or e_lfanew + 0x18 > len(data):
        return False
    if data[e_lfanew:e_lfanew + 4] != b"PE\0\0":
        return False
    opt = e_lfanew + 24
    magic = struct.unpack_from("<H", data, opt)[0]
    if magic == 0x10B:      # PE32
        dd = opt + 96
    elif magic == 0x20B:    # PE32+
        dd = opt + 112
    else:
        return False
    if dd + 15 * 8 > len(data):
        return False
    cli_rva, cli_size = struct.unpack_from("<II", data, dd + 14 * 8)
    if cli_rva == 0 or cli_size == 0:
        return False
    return b"BSJB" in data[: min(len(data), 4 * 1024 * 1024)]


def pe_size(data):
    """从节表算映像大小，用来越界裁剪"""
    try:
        e = struct.unpack_from("<I", data, 0x3C)[0]
        nsec = struct.unpack_from("<H", data, e + 6)[0]
        optsz = struct.unpack_from("<H", data, e + 20)[0]
        sec = e + 24 + optsz
        end = 0
        for i in range(nsec):
            off = sec + i * 40
            raw_size = struct.unpack_from("<I", data, off + 16)[0]
            raw_ptr = struct.unpack_from("<I", data, off + 20)[0]
            end = max(end, raw_ptr + raw_size)
        return end or len(data)
    except Exception:
        return len(data)


def main():
    args = sys.argv[1:]
    pid = None
    outdir = os.path.join(os.environ.get("TEMP", "."), "gqy-dump")
    for i, a in enumerate(args):
        if a == "--pid":
            pid = int(args[i + 1])
        elif a == "--out":
            outdir = args[i + 1]

    if pid is None:
        pid = find_pid()
    if not pid:
        print("找不到 HLF10631030.exe 进程")
        return 1

    os.makedirs(outdir, exist_ok=True)
    h = k32.OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, False, pid)
    if not h:
        print("OpenProcess 失败", ctypes.get_last_error())
        return 1

    print(f"扫描 pid={pid} …")
    found = []
    scanned = 0
    for base, size in iter_regions(h):
        scanned += size
        data = read(h, base, size)
        if not data:
            continue
        # 一个区域里可能有多个映像，按 MZ 分片
        pos = 0
        while True:
            idx = data.find(b"MZ", pos)
            if idx < 0 or idx + 0x40 > len(data):
                break
            chunk = data[idx:]
            if is_dotnet_pe(chunk):
                actual = pe_size(chunk)
                if 100 * 1024 <= actual <= 20 * 1024 * 1024:
                    blob = chunk[:actual]
                    found.append((base + idx, actual, blob))
                    pos = idx + max(actual, 0x1000)
                    continue
            pos = idx + 2
    print(f"扫描 {scanned/1024/1024:.0f} MB，命中 {len(found)} 个 .NET 映像")

    seen = set()
    n = 0
    for addr, size, blob in found:
        key = (size, blob[:64])
        if key in seen:
            continue
        seen.add(key)
        # 用元数据里的程序集名做文件名
        name = "unknown"
        m = re.search(rb"[\x20-\x7e]{4,40}", blob[:0x20000])
        for cand in re.finditer(rb"Assembly-CSharp[\w\.\-]*", blob):
            name = cand.group(0).decode("ascii", "ignore")
            break
        fn = os.path.join(outdir, f"{name}_{addr:x}.dll")
        with open(fn, "wb") as f:
            f.write(blob)
        n += 1
        print(f"  → {fn}  ({size/1024:.0f} KB)")
    print(f"完成，导出 {n} 个文件到 {outdir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
