"""Encode one PNG to stdout after checking its pixels and color interpretation."""
import io
import json
import struct
import sys
import warnings
import zlib

from PIL import Image, ImageCms, features

PILLOW_VERSION = "13.0.0"
WEBP_VERSION = "1.6.0"
MAX_PIXELS = 4_194_304
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PLAIN_CHUNKS = {b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS",
                b"pHYs", b"tIME", b"tEXt", b"zTXt", b"iTXt"}
COLOR_CHUNKS = {b"sRGB", b"iCCP", b"gAMA", b"cHRM"}
SRGB_CHROMATICITIES = struct.pack(">8I", 31270, 32900, 64000, 33000,
                                 30000, 60000, 15000, 6000)


class KeepSource(ValueError):
    pass


def encode(image, profile=None, thorough=False):
    output = io.BytesIO()
    image.save(output, format="WEBP", lossless=True, exact=True,
               method=6 if thorough else 4, quality=100 if thorough else 80,
               icc_profile=profile)
    return output.getvalue()


def codec_identity():
    if Image.__version__ != PILLOW_VERSION or features.version("webp") != WEBP_VERSION:
        raise KeepSource("codec-version-mismatch")
    test_image = Image.frombytes("RGBA", (2, 1), bytes([38, 97, 18, 0, 28, 19, 23, 255]))
    with Image.open(io.BytesIO(encode(test_image))) as decoded:
        if test_image.tobytes() != decoded.convert("RGBA").tobytes():
            raise KeepSource("codec-loses-transparent-rgb")
    return {
        "pillow": PILLOW_VERSION, "libwebp": WEBP_VERSION,
        "zlib": features.version("zlib"), "exact": True,
    }


def png_color_chunks(data):
    if not data.startswith(PNG_MAGIC):
        raise KeepSource("invalid-png")
    chunks = {}
    offset = len(PNG_MAGIC)
    while offset + 12 <= len(data):
        length, kind = struct.unpack_from(">I4s", data, offset)
        end = offset + 8 + length
        if end + 4 > len(data) or zlib.crc32(data[offset + 4:end]) != struct.unpack_from(">I", data, end)[0]:
            raise KeepSource("invalid-png-chunk")
        chunk = data[offset + 8:end]
        if not chunks and kind != b"IHDR":
            raise KeepSource("invalid-png-header")
        if kind in {b"acTL", b"fcTL", b"fdAT"}:
            raise KeepSource("animated-png")
        if kind not in PLAIN_CHUNKS | COLOR_CHUNKS:
            raise KeepSource("unsupported-png-chunk:" + kind.decode("ascii", errors="replace"))
        if kind in COLOR_CHUNKS | {b"IHDR"} and kind in chunks:
            raise KeepSource("repeated-png-color-or-header-chunk")
        chunks[kind] = chunk if kind in COLOR_CHUNKS | {b"IHDR"} else None
        offset = end + 4
        if kind == b"IEND":
            if length != 0 or offset != len(data) or b"IDAT" not in chunks:
                raise KeepSource("invalid-png-end")
            return chunks
    raise KeepSource("invalid-png-end")


def optimize(data, thorough=False):
    chunks = png_color_chunks(data)
    header = chunks[b"IHDR"]
    if len(header) != 13:
        raise KeepSource("invalid-png-header")
    width, height, depth = struct.unpack_from(">IIB", header)
    if width <= 1 and height <= 1:
        raise KeepSource("fixed-pixel")
    if depth != 8:
        raise KeepSource("png-depth-outside-8-bit")
    if width * height > MAX_PIXELS:
        raise KeepSource("png-pixel-budget")

    gamma = chunks.get(b"gAMA")
    chromaticity = chunks.get(b"cHRM")
    srgb = chunks.get(b"sRGB")
    has_profile = b"iCCP" in chunks
    if srgb is not None and (len(srgb) != 1 or srgb[0] != 0 or has_profile):
        raise KeepSource("unsupported-srgb-rendering-intent")
    if (gamma not in {None, struct.pack(">I", 45455)}
            or chromaticity not in {None, SRGB_CHROMATICITIES}
            or ((gamma is not None or chromaticity is not None) and srgb is None and not has_profile)):
        raise KeepSource("unverified-png-color")
    with Image.open(io.BytesIO(data), formats=["PNG"]) as source:
        if source.is_animated:
            raise KeepSource("animated-png")
        profile = source.info.get("icc_profile")
        if has_profile and (not profile or len(profile) < 128 or profile[16:20] != b"RGB "):
            raise KeepSource("invalid-or-non-rgb-icc")
        if profile:
            try:
                ImageCms.getOpenProfile(io.BytesIO(profile))
            except ImageCms.PyCMSError as error:
                raise KeepSource("invalid-or-non-rgb-icc") from error
        rgba = source.convert("RGBA")
    candidate = encode(rgba, profile)
    if thorough:
        candidate = min(candidate, encode(rgba, profile, thorough=True), key=len)
    with Image.open(io.BytesIO(candidate), formats=["WEBP"]) as decoded:
        if decoded.info.get("icc_profile") != profile:
            raise KeepSource("webp-icc-mismatch")
        if decoded.size != rgba.size or decoded.convert("RGBA").tobytes() != rgba.tobytes():
            raise KeepSource("webp-rgba-mismatch")
    return candidate


def main():
    """
    A structured status line precedes binary stdout. Input is bounded by the caller.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            identity = codec_identity()
            if sys.argv[1:] == ["--probe"]:
                print(json.dumps(identity))
                return
            candidate = optimize(sys.stdin.buffer.read(), thorough=sys.argv[1:] == ["--thorough"])
        sys.stdout.buffer.write(b'{"reason":"lossless-webp"}\n' + candidate)
    except KeepSource as error:
        print(json.dumps({"reason": str(error)}))
    except (OSError, ValueError, Warning):
        print(json.dumps({"reason": "png-decode-or-webp-encode-failed"}))


if __name__ == "__main__":
    main()
