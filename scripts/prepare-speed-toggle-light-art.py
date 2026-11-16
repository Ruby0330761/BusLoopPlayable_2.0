"""Build the light speed-toggle badge glyphs (1x play / 2x skip).

The light skin draws the pill itself in CSS and only needs the round badge: a
flat #57a5ed disc, the white play/skip glyph, and the one-step-darker #4c90cf
outline the reference draws around that glyph. Both files are square with the
disc bleeding to the edge, so the runtime sizes them from the button height
(`object-fit: contain`) and nothing has to be measured.

Geometry was fitted to the supplied 177x96 badges by maximising the IoU of the
generated white ink against the reference ink, both rendered at the reference's
own 61px disc (see `docs` note in the commit: 0.94 for 1x, 0.92 for 2x). Every
number below is a fraction of that disc:

    triangle height    0.500   (the corner arcs consume ~5% of it)
    triangle width     0.330
    corner radius      0.070 of the triangle height
    skip advance       0.245   centre-to-centre, so the pair overlaps a little
    ink offset        +0.082, -0.015 from the disc centre: a right-pointing
                      triangle centred by its box reads left-heavy
    outline            0.049 outside the ink, no offset

Run with the Pillow-equipped Python3; no network or asset upload.
"""
from pathlib import Path
import math

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/applovin'

SIZE = 128             # final square asset; the button is ~70 CSS px tall
SUPERSAMPLE = 8        # drawn at 8x, downsampled with LANCZOS
DISC = '#57a5ed'       # flat badge blue, sampled from the reference
GLYPH = '#ffffff'
STROKE = '#4c90cf'     # one step darker than the disc

TRIANGLE_HEIGHT = 0.500
TRIANGLE_WIDTH = 0.330
CORNER = 0.070         # of the triangle height
STROKE_WIDTH = 0.049
SKIP_ADVANCE = 0.245
INK_OFFSET = (0.082, -0.015)
ARC_STEPS = 24


def offset_polygon(points, distance):
    """Move every edge outward by `distance` and intersect neighbours (convex only).

    The outline is the Minkowski sum of the white glyph with a disc, so its outer
    boundary is this outset polygon with its corners rounded by
    `radius + distance`. Rounding the *unexpanded* triangle and hoping the arcs
    land outside does not work: the tangent construction pulls corners inward, so
    the outline would hide inside the white glyph.
    """
    cx = sum(point[0] for point in points) / len(points)
    cy = sum(point[1] for point in points) / len(points)
    lines = []
    for index, start in enumerate(points):
        end = points[(index + 1) % len(points)]
        dx, dy = end[0] - start[0], end[1] - start[1]
        length = math.hypot(dx, dy)
        nx, ny = -dy / length, dx / length
        # Flip the normal so it points at the centroid (the inside).
        if nx * (cx - start[0]) + ny * (cy - start[1]) < 0:
            nx, ny = -nx, -ny
        lines.append(((start[0] - nx * distance, start[1] - ny * distance),
                      (end[0] - nx * distance, end[1] - ny * distance)))
    output = []
    for index, (a, b) in enumerate(lines):
        c, d = lines[(index + 1) % len(lines)]
        denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0])
        if abs(denominator) < 1e-6:
            output.append(b)
            continue
        t = ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) / denominator
        output.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return output


def rounded_outline(vertices, radius, steps=ARC_STEPS):
    """Outline of a convex polygon with each corner replaced by a circular arc."""
    points = []
    for index, vertex in enumerate(vertices):
        previous = vertices[index - 1]
        following = vertices[(index + 1) % len(vertices)]

        def unit(from_point, to_point):
            dx, dy = to_point[0] - from_point[0], to_point[1] - from_point[1]
            length = math.hypot(dx, dy)
            return dx / length, dy / length

        # Directions from the vertex into the two adjacent edges.
        first = unit(vertex, previous)
        second = unit(vertex, following)
        interior = math.acos(max(-1.0, min(1.0, first[0] * second[0] + first[1] * second[1])))
        if radius <= 0 or interior >= math.pi - 1e-6:
            points.append(vertex)
            continue
        tangent = radius / math.tan(interior / 2)
        start = (vertex[0] + first[0] * tangent, vertex[1] + first[1] * tangent)
        end = (vertex[0] + second[0] * tangent, vertex[1] + second[1] * tangent)
        bisector = (first[0] + second[0], first[1] + second[1])
        bisector_length = math.hypot(*bisector)
        center = (
            vertex[0] + bisector[0] / bisector_length * radius / math.sin(interior / 2),
            vertex[1] + bisector[1] / bisector_length * radius / math.sin(interior / 2),
        )
        from_angle = math.atan2(start[1] - center[1], start[0] - center[0])
        to_angle = math.atan2(end[1] - center[1], end[0] - center[0])
        sweep = to_angle - from_angle
        while sweep > math.pi:
            sweep -= 2 * math.pi
        while sweep < -math.pi:
            sweep += 2 * math.pi
        for step in range(steps + 1):
            angle = from_angle + sweep * step / steps
            points.append((center[0] + radius * math.cos(angle),
                           center[1] + radius * math.sin(angle)))
    return points


def triangle(width, height):
    """Right-pointing triangle centred on the origin."""
    return [(-width / 2, height / 2), (width / 2, 0), (-width / 2, -height / 2)]


def triangle_offsets(kind):
    """Horizontal offset of each triangle centre, in disc diameters."""
    if kind == 'normal':
        return [0.0]
    return [-SKIP_ADVANCE / 2, SKIP_ADVANCE / 2]


def main():
    size = SIZE * SUPERSAMPLE
    height = TRIANGLE_HEIGHT * size
    width = TRIANGLE_WIDTH * size
    radius = CORNER * height
    stroke = STROKE_WIDTH * size
    center_x, center_y = INK_OFFSET[0] * size, INK_OFFSET[1] * size

    disc = Image.new('L', (size, size), 0)
    ImageDraw.Draw(disc).ellipse((0, 0, size - 1, size - 1), fill=255)

    for kind, filename in (('normal', 'speed-toggle-icon-light-normal.png'),
                           ('boost', 'speed-toggle-icon-light-boost.png')):
        layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        layer.paste(Image.new('RGBA', (size, size), DISC), (0, 0), disc)
        shapes = [triangle(width, height)] * len(triangle_offsets(kind))
        # Outline first, white glyphs on top. The two skip triangles keep their
        # own outlines so the blue notch between them survives, as in the
        # reference, instead of merging into one blob.
        passes = (
            (offset_polygon, stroke, radius + stroke, STROKE),
            (None, 0.0, radius, GLYPH),
        )
        draw = ImageDraw.Draw(layer)
        for expand, outset, corner, color in passes:
            for points, dx in zip(shapes, triangle_offsets(kind)):
                vertices = expand(points, outset) if expand else points
                outline = rounded_outline(vertices, corner)
                draw.polygon(
                    [(center_x + size / 2 + dx * size + x, center_y + size / 2 + y)
                     for x, y in outline],
                    fill=color
                )
        layer.resize((SIZE, SIZE), Image.LANCZOS).save(OUT / filename)
        print(filename, f'{(OUT / filename).stat().st_size / 1024:.1f} KB')


if __name__ == '__main__':
    main()
