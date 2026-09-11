"""Generate sample comparison images for manual/frontend testing."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(r"D:\TOOLS\picture_compare\test_fixtures")
OUT.mkdir(parents=True, exist_ok=True)


def font(size: int):
    for name in (
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/seguisym.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make(label: str, bg: tuple, accent: tuple, path: Path, size=(960, 720)) -> Path:
    im = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(im)
    w, h = size
    # decorative blocks
    for i in range(6):
        x = 80 + i * 40
        y = 120 + (i % 3) * 30
        d.rectangle([x, y, x + 180, y + 120], fill=accent if i % 2 == 0 else bg)
        d.ellipse([x + 20, y + 20, x + 140, y + 100], outline=(255, 255, 255), width=3)
    d.rectangle([40, 40, w - 40, h - 40], outline=(255, 255, 255), width=2)
    f = font(48)
    d.text((60, h // 2 - 30), label, fill=(255, 255, 255), font=f)
    f2 = font(22)
    d.text((60, 60), path.name, fill=(230, 230, 230), font=f2)
    im.save(path, quality=92)
    print("wrote", path, im.size)
    return path


make("A 效果", (180, 50, 50), (220, 120, 120), OUT / "A效果_红.png")
make("B 效果", (40, 80, 180), (100, 150, 230), OUT / "B效果_蓝.png")
make("C 效果", (40, 140, 80), (120, 200, 140), OUT / "C效果_绿.png")
make("D 效果", (140, 90, 40), (200, 160, 90), OUT / "D效果_橙.jpg")
make("E 未入分享", (90, 40, 140), (160, 120, 220), OUT / "E_仅后台.png")

# one landscape phone-friendly image
make("横屏测试", (20, 20, 20), (91, 141, 239), OUT / "横屏_A.jpg", size=(1280, 720))
make("横屏测试B", (20, 20, 30), (239, 141, 91), OUT / "横屏_B.jpg", size=(1280, 720))

print("done ->", OUT)
