from pathlib import Path
from PIL import Image, ImageDraw


def main():
    out_dir = Path("/app/tests/fixtures")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "full_body_fixture.jpg"

    w, h = 720, 1080
    img = Image.new("RGB", (w, h), (214, 216, 220))
    draw = ImageDraw.Draw(img)

    for y in range(0, h, 16):
        draw.line([(0, y), (w, y)], fill=(80 + (y % 120), 100 + (y % 80), 120 + (y % 60)), width=2)

    draw.rectangle((110, 120, w - 110, h - 150), outline=(25, 25, 25), width=6)
    draw.ellipse((w // 2 - 75, 180, w // 2 + 75, 340), fill=(185, 145, 125), outline=(40, 40, 40), width=4)
    draw.rectangle((w // 2 - 60, 350, w // 2 + 60, 700), fill=(55, 80, 110), outline=(30, 30, 30), width=3)
    draw.rectangle((w // 2 - 140, 700, w // 2 - 30, h - 170), fill=(45, 45, 45), outline=(25, 25, 25), width=3)
    draw.rectangle((w // 2 + 30, 700, w // 2 + 140, h - 170), fill=(45, 45, 45), outline=(25, 25, 25), width=3)

    img.save(out_path, format="JPEG", quality=92)
    print(str(out_path))


if __name__ == "__main__":
    main()
