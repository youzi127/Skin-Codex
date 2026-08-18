from pathlib import Path

from PIL import Image, ImageOps


SOURCE = Path(r"C:\Users\Administrator\.codex\generated_images\2026\07\28\your-name-katawaredoki-warm-sunset-preview-20260728-195000.png")
TARGET = Path(__file__).resolve().parents[1] / "samples" / "theme-packs" / "sample-b-plus-your-name" / "background.png"
TARGET_SIZE = (1672, 941)


def main() -> None:
    with Image.open(SOURCE) as image:
        # Preserve the selected image pixels and character proportions; 16:9 only removes equal top/bottom margins.
        final = ImageOps.fit(image.convert("RGBA"), TARGET_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        final.save(TARGET, "PNG", optimize=True)
    print(TARGET)


if __name__ == "__main__":
    main()
