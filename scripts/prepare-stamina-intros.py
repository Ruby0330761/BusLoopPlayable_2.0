"""Adapt the supplied opening module for new counts using existing local artwork.

Run with the existing Pillow-equipped Python runtime; no network or asset upload.
Original 1/3/5/10 runtime files remain untouched.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/applovin/stamina'
ORIGINAL = Image.open(ASSETS / 'intro-3.png').convert('RGBA')
ONE = Image.open(ASSETS / 'intro-1-source.png').convert('RGBA')
HEART = Image.open(ASSETS / 'heart.png').convert('RGBA')
FONT = ImageFont.truetype(str(ROOT / 'public/assets/unity/fonts/Poppins-Bold.ttf'), 158)


def clear_region(image, source, box, feather):
    left, top, right, bottom = box
    patch = Image.new('RGBA', (right - left, bottom - top))
    pixels = patch.load()
    # Interpolate clean pixels at both edges instead of stretching a strip:
    # this preserves the panel's horizontal light falloff without a pasted box.
    for y in range(top, bottom):
        a, b = source.getpixel((left, y)), source.getpixel((right, y))
        for x in range(right - left):
            t = x / (right - left - 1)
            pixels[x, y - top] = tuple(round(a[c] * (1 - t) + b[c] * t) for c in range(4))
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).rectangle(box, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    # Expanded panel beneath the feather keeps all edge samples defined.
    full = image.copy()
    full.paste(patch, (left, top))
    return Image.composite(full, image, mask)


def prepare(count):
    image = ORIGINAL.copy()
    # Reuse the already-clean parts of the one-heart adaptation at the same Y.
    image = clear_region(image, ORIGINAL, (223, 30, 362, 195), 2)
    image = clear_region(image, ONE, (142, 256, 942, 492), 3)

    mask = Image.new('L', image.size)
    text = str(count)
    box = FONT.getbbox(text)
    x = 293 - (box[2] - box[0]) / 2 - box[0]
    y = 49 - box[1]
    ImageDraw.Draw(mask).text((x, y), text, font=FONT, fill=255)
    # Match the existing yellow/orange raised lettering, retaining REVIVES!.
    shadow = Image.new('RGBA', image.size)
    shadow.paste((29, 38, 64, 190), (0, 0), mask.filter(ImageFilter.GaussianBlur(4)))
    image.alpha_composite(shadow, (1, 8))
    extrusion = Image.new('RGBA', image.size)
    extrusion.paste((209, 111, 0, 255), (0, 0), mask)
    image.alpha_composite(extrusion, (0, 7))
    gradient = Image.new('RGBA', image.size)
    draw = ImageDraw.Draw(gradient)
    for line in range(49, 176):
        t = min(1, (line - 49) / 120)
        draw.line((0, line, image.width, line), fill=(255, round(238 - 66 * t), round(76 * (1 - t)), 255))
    image.alpha_composite(Image.composite(gradient, Image.new('RGBA', image.size), mask))

    columns = count if count <= 5 else (count + 1) // 2
    rows = [count] if count <= 5 else [columns, count - columns]
    size, gap, row_gap = (220 if count == 2 else 176, 32, 0) if count <= 5 else (128, 26, 14)
    group_height = len(rows) * size + (len(rows) - 1) * row_gap
    top = 374 - group_height / 2
    for row, length in enumerate(rows):
        width = length * size + (length - 1) * gap
        for column in range(length):
            icon = HEART.resize((size, size), Image.Resampling.LANCZOS)
            image.alpha_composite(icon, (round((image.width - width) / 2 + column * (size + gap)), round(top + row * (size + row_gap))))
    image.save(ASSETS / f'intro-{count}-source.png')
    runtime = image.resize((620, round(image.height * 620 / image.width)), Image.Resampling.LANCZOS)
    runtime.save(ASSETS / f'intro-{count}.webp', lossless=True, exact=True, method=6)
    # Decode the saved runtime resource, not just the source in memory.
    assert Image.open(ASSETS / f'intro-{count}.webp').convert('RGBA').tobytes() == runtime.tobytes()
    print(f'{count}: {runtime.size}, {(ASSETS / f"intro-{count}.webp").stat().st_size} bytes')


if __name__ == '__main__':
    for count in (2, 4, 6, 7, 8, 9):
        prepare(count)
