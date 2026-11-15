"""把内存 dump 出来的「已映射」PE 重排回磁盘文件布局。

内存中节数据按 SectionAlignment(0x1000) 排列，文件里按 FileAlignment(0x200) 排列。
直接 dump 得到的映像，节表里的 PointerToRawData 对不上实际数据位置，
导致 ILSpy 能读元数据表、但方法体 RVA 全错（整文件反编译 0 字节）。

用法：python tools/fix-pe.py <输入.dll> <输出.dll>
"""
import struct
import sys


def unmap(data: bytes) -> bytes:
    if data[:2] != b"MZ":
        raise ValueError("不是 PE")
    e = struct.unpack_from("<I", data, 0x3C)[0]
    assert data[e:e + 4] == b"PE\0\0", "PE 签名错误"

    nsec = struct.unpack_from("<H", data, e + 6)[0]
    optsz = struct.unpack_from("<H", data, e + 20)[0]
    opt = e + 24
    magic = struct.unpack_from("<H", data, opt)[0]
    if magic == 0x10B:
        size_of_headers = struct.unpack_from("<I", data, opt + 60)[0]
    else:
        size_of_headers = struct.unpack_from("<I", data, opt + 60)[0]

    sec = opt + optsz
    sections = []
    max_raw_end = size_of_headers
    for i in range(nsec):
        off = sec + i * 40
        name = data[off:off + 8].rstrip(b"\0")
        vsize = struct.unpack_from("<I", data, off + 8)[0]
        va = struct.unpack_from("<I", data, off + 12)[0]
        raw_size = struct.unpack_from("<I", data, off + 16)[0]
        raw_ptr = struct.unpack_from("<I", data, off + 20)[0]
        sections.append((name, va, vsize, raw_ptr, raw_size))
        max_raw_end = max(max_raw_end, raw_ptr + raw_size)

    out = bytearray(max_raw_end)
    out[:size_of_headers] = data[:size_of_headers]

    fixed = 0
    for name, va, vsize, raw_ptr, raw_size in sections:
        if raw_size == 0:
            continue
        # 内存里数据在 [va, va+vsize)，要搬到 [raw_ptr, raw_ptr+raw_size)
        src = data[va: va + raw_size]
        if len(src) < raw_size:
            src = src + b"\0" * (raw_size - len(src))
        # 判断是否已就位（如果 va==raw_ptr 说明本来就是文件布局）
        if va != raw_ptr:
            fixed += 1
        out[raw_ptr: raw_ptr + raw_size] = src

    return bytes(out), fixed


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    raw = open(src, "rb").read()
    fixed_blob, n = unmap(raw)
    open(dst, "wb").write(fixed_blob)
    print(f"{src}: {len(raw)} -> {len(fixed_blob)} 字节，重排 {n} 个节")
