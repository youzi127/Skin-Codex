from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps


SOURCE = Path(r"C:\Users\Administrator\.codex\generated_images\2026\07\28\your-name-katawaredoki-bright-subtle-scale-preview-20260728-185617.png")
OUTPUT = Path(r"C:\Users\Administrator\.codex\generated_images\2026\07\28\your-name-katawaredoki-sunset-locked-16x9-preview.png")


def make_sunset_variant(source: Image.Image) -> Image.Image:
    """Only remaps color/light with masks; geometry and every source pixel position stay fixed."""
    width, height = source.size
    base = source.convert("RGBA")

    # Broad lower-left warm grade. It fades before the characters and upper-right sky.
    grade_mask = Image.new("L", (width, height), 0)
    pixels = grade_mask.load()
    for y in range(height):
        vertical = max(0.0, min(1.0, (y / height - 0.42) / 0.58))
        for x in range(width):
            horizontal = max(0.0, min(1.0, 1.0 - x / (width * 0.64)))
            pixels[x, y] = round(186 * vertical * horizontal)
    grade_mask = grade_mask.filter(ImageFilter.GaussianBlur(radius=42))
    bright_pixels = ImageOps.grayscale(base).point(lambda value: max(0, min(255, round((value - 104) * 1.68))))
    warm_highlights = ImageChops.multiply(grade_mask, bright_pixels)
    # Keep a clean circular sun core and its immediate bloom out of the warm cloud recolour.
    sun_protection = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(sun_protection)
    sun_center = (round(width * 0.252), round(height * 0.735))
    draw.ellipse((sun_center[0] - 48, sun_center[1] - 30, sun_center[0] + 48, sun_center[1] + 30), fill=255)
    sun_protection = sun_protection.filter(ImageFilter.GaussianBlur(radius=28))
    warm_highlights = ImageChops.subtract(warm_highlights, sun_protection)
    warm_grade = Image.new("RGBA", (width, height), (246, 75, 43, 255))
    # Only re-colour the sunlit/highlighted pixels: linework and figure geometry remain intact.
    base = Image.composite(warm_grade, base, warm_highlights)

    # Local red-orange glow in the original sun region, left-bottom only.
    glow_mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(glow_mask)
    center = sun_center
    max_radius = round(min(width, height) * 0.31)
    for radius in range(max_radius, 0, -12):
        progress = radius / max_radius
        alpha = round(132 * (1.0 - progress) ** 2)
        box = (center[0] - radius, center[1] - radius * 0.42, center[0] + radius, center[1] + radius * 0.42)
        draw.ellipse(box, fill=alpha)
    glow_mask = glow_mask.filter(ImageFilter.GaussianBlur(radius=28))
    glow_mask = ImageChops.multiply(glow_mask, bright_pixels)
    glow_mask = ImageChops.subtract(glow_mask, sun_protection)
    glow = Image.new("RGBA", (width, height), (255, 87, 46, 255))
    result = Image.composite(glow, base, glow_mask)
    # Restore the exact white-yellow sun core, retaining the source geometry and luminous focal point.
    original_rgba = source.convert("RGBA")
    return Image.composite(original_rgba, result, sun_protection)


if __name__ == "__main__":
    with Image.open(SOURCE) as original:
        result = make_sunset_variant(original)
        result.save(OUTPUT, "PNG", optimize=True)
    print(OUTPUT)
