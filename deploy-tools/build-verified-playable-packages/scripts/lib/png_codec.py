from __future__ import annotations

import struct
import zlib
from pathlib import Path


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _paeth(left: int, up: int, upper_left: int) -> int:
    estimate = left + up - upper_left
    left_distance = abs(estimate - left)
    up_distance = abs(estimate - up)
    upper_left_distance = abs(estimate - upper_left)
    if left_distance <= up_distance and left_distance <= upper_left_distance:
        return left
    return up if up_distance <= upper_left_distance else upper_left


def read_rgba(path: Path) -> tuple[int, int, list[tuple[int, int, int, int]]]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"只支持 PNG 图片：{path}")
    offset = len(PNG_SIGNATURE)
    width = height = bit_depth = color_type = interlace = None
    compressed = bytearray()
    palette: list[tuple[int, int, int]] = []
    transparency = b""
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        if offset + 12 + length > len(data):
            raise ValueError(f"PNG chunk 已截断：{path}")
        payload = data[offset + 8:offset + 8 + length]
        expected_crc = struct.unpack(">I", data[offset + 8 + length:offset + 12 + length])[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != expected_crc:
            raise ValueError(f"PNG CRC 无效：{path}")
        offset += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(">IIBBBBB", payload)
            if compression != 0 or filter_method != 0:
                raise ValueError(f"PNG 压缩或过滤方法不受支持：{path}")
        elif kind == b"PLTE":
            if not payload or len(payload) % 3 or len(payload) > 256 * 3:
                raise ValueError(f"PNG palette 无效：{path}")
            palette = [
                (payload[index], payload[index + 1], payload[index + 2])
                for index in range(0, len(payload), 3)
            ]
        elif kind == b"tRNS":
            transparency = payload
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            break
    if not width or not height or bit_depth != 8 or color_type not in {2, 3, 6} or interlace != 0:
        raise ValueError(f"当前仅支持 8-bit、非隔行 RGB/RGBA/索引色 PNG：{path}")
    if color_type == 3 and (not palette or len(transparency) > len(palette)):
        raise ValueError(f"PNG palette 或透明度表无效：{path}")
    channels = {2: 3, 3: 1, 6: 4}[color_type]
    stride = width * channels
    decoded = zlib.decompress(bytes(compressed))
    if len(decoded) != height * (stride + 1):
        raise ValueError(f"PNG 像素长度无效：{path}")
    rows: list[bytearray] = []
    position = 0
    previous = bytearray(stride)
    for _ in range(height):
        filter_type = decoded[position]
        raw = decoded[position + 1:position + 1 + stride]
        position += stride + 1
        row = bytearray(stride)
        for index, byte in enumerate(raw):
            left = row[index - channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            predictor = {
                0: 0,
                1: left,
                2: up,
                3: (left + up) // 2,
                4: _paeth(left, up, upper_left),
            }.get(filter_type)
            if predictor is None:
                raise ValueError(f"PNG filter 无效：{filter_type}")
            row[index] = (byte + predictor) & 0xFF
        rows.append(row)
        previous = row
    pixels: list[tuple[int, int, int, int]] = []
    for row in rows:
        for index in range(0, len(row), channels):
            if color_type == 6:
                pixels.append(tuple(row[index:index + 4]))  # type: ignore[arg-type]
            elif color_type == 2:
                pixels.append((row[index], row[index + 1], row[index + 2], 255))
            else:
                palette_index = row[index]
                if palette_index >= len(palette):
                    raise ValueError(f"PNG palette 索引越界：{path}")
                red, green, blue = palette[palette_index]
                alpha = transparency[palette_index] if palette_index < len(transparency) else 255
                pixels.append((red, green, blue, alpha))
    return width, height, pixels


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def write_rgba(path: Path, width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> None:
    if width < 1 or height < 1 or len(pixels) != width * height:
        raise ValueError("PNG 输出尺寸或像素数量无效")
    rows = []
    for y in range(height):
        rows.append(b"\x00" + b"".join(bytes(pixel) for pixel in pixels[y * width:(y + 1) * width]))
    output = (
        PNG_SIGNATURE
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + _chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(output)
