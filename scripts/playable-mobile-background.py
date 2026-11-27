"""Build a phone-sized background and its original-to-cropped texture mapping."""
import io
import json
import sys

from PIL import Image, ImageChops


def repeated_edge_rows(image):
    width, height = image.size
    if height < 3:
        return 0, height
    differences = ImageChops.difference(image.crop((0, 1, width, height)),
                                        image.crop((0, 0, width, height - 1)))
    bounds = differences.getbbox(alpha_only=False)
    # Keep a few identical rows for linear filtering at the texture edges.
    return (max(0, bounds[1] - 2), min(height, bounds[3] + 3)) if bounds else (0, 1)


def encode(source):
    if source.width * source.height > 16_000_000 or getattr(source, "is_animated", False):
        raise ValueError("unsupported-background")
    if source.getexif().get(274, 1) != 1:
        raise ValueError("oriented-background")
    image = source.convert("RGBA" if source.has_transparency_data else "RGB")
    for short, long in [(1080, 1920), (900, 1600), (720, 1280)]:
        target = (short, long) if image.height >= image.width else (long, short)
        image.thumbnail(target, Image.Resampling.LANCZOS)
        width, height = image.size
        top, bottom = repeated_edge_rows(image)
        cropped = image.crop((0, top, width, bottom))
        # UV offset uses a bottom-left origin. Keep the mapping in the file
        # identity too, since the packager interns identical image data URIs.
        rect = dict(x=0, y=bottom-height, width=width, height=height,
                    imageWidth=width, imageHeight=bottom-top)
        mapping = (f'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
                   f'<rdf:Description xmlns:bg="urn:playable:background" '
                   f'bg:rows="{height},{top},{bottom}"/></rdf:RDF>').encode() if cropped.size != image.size else b""
        for quality in (88, 78, 68):
            output = io.BytesIO()
            cropped.save(output, "WEBP", quality=quality, method=4,
                         icc_profile=source.info.get("icc_profile", b""), xmp=mapping)
            data = output.getvalue()
            if len(data) < 100_000:
                return rect if mapping else None, data
    return rect if mapping else None, data


if __name__ == "__main__":
    with Image.open(io.BytesIO(sys.stdin.buffer.read()), formats=["JPEG", "PNG", "WEBP"]) as source:
        rect, encoded = encode(source)
    sys.stdout.buffer.write(json.dumps({"rect": rect}).encode() + b"\n" + encoded)
