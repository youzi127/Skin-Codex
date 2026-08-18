from pathlib import Path
from PIL import Image


root = Path(__file__).resolve().parents[1]
source = Path(r"C:\Users\Administrator\.codex\generated_images\2026\07\28\your-name-katawaredoki-bright-subtle-scale-preview-20260728-185617.png")
variant = Path(r"C:\Users\Administrator\.codex\generated_images\2026\07\28\your-name-katawaredoki-sunset-locked-16x9-preview.png")

assert source.exists(), "Selected original wallpaper is missing."
assert variant.exists(), "Sunset variant has not been generated."

with Image.open(source) as original, Image.open(variant) as edited:
    assert original.size == (1672, 941)
    assert edited.size == original.size, "The sunset edit must retain the original 16:9 pixel dimensions."
    # The original sun sits at lower-left around (418, 692); its light core must remain brighter than the warm horizon.
    assert sum(edited.convert("RGB").getpixel((418, 692))) > 600, "The sunset edit must retain the bright sun core."
