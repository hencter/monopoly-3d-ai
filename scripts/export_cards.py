"""Export generated card arts → public/textures/cards/*.png (cropped, labeled)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SESSION_MARK = "019f7571"
OUT = Path(__file__).resolve().parents[1] / "public" / "textures" / "cards"
W, H = 384, 576  # portrait card

# session image id → item key
# verified by visual check
MAP = {
    "21.jpg": ("remote", "遥控骰子"),
    "19.jpg": ("boost", "加速卡"),
    "18.jpg": ("rentFree", "免租卡"),
    "20.jpg": ("demolish", "拆迁卡"),
    "17.jpg": ("equalize", "均富卡"),
    "22.jpg": ("rob", "抢夺卡"),
    "24.jpg": ("swap", "换地卡"),
    "25.jpg": ("hibernate", "冬眠卡"),
    "23.jpg": ("intel", "资讯卡"),
    "26.jpg": ("back", None),
}

MAGENTA = (220, 0, 180)  # approx key color


def find_img_dir() -> Path:
    root = Path(r"C:\Users\hencter\.grok\sessions")
    hits = [p for p in root.rglob("26.jpg") if SESSION_MARK in str(p)]
    if hits:
        return hits[0].parent
    hits = sorted(root.rglob("26.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)
    return hits[0].parent


def key_crop(im: Image.Image) -> Image.Image:
    """Remove magenta bg by alpha; tight crop to non-magenta content."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    # threshold magenta-ish
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # magenta / hot pink key
            if r > 160 and b > 100 and g < 120 and r > g + 40:
                mp[x, y] = 0
            else:
                mp[x, y] = 255
    im.putalpha(mask)
    bbox = mask.getbbox()
    if bbox:
        im = im.crop(bbox)
    return im


def fit_card(im: Image.Image) -> Image.Image:
    """Letterbox into W×H with dark navy pad."""
    im = im.convert("RGBA")
    # scale to fit
    scale = min(W / im.width, H / im.height)
    nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (12, 20, 36, 255))
    canvas.paste(im, ((W - nw) // 2, (H - nh) // 2), im)
    return canvas


def add_label(im: Image.Image, name: str) -> Image.Image:
    draw = ImageDraw.Draw(im)
    band_h = 72
    y0 = H - band_h - 18
    # semi bar
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([18, y0, W - 18, y0 + band_h], radius=14, fill=(8, 14, 28, 210))
    im = Image.alpha_composite(im, overlay)
    draw = ImageDraw.Draw(im)
    font = None
    for fp in [
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ]:
        try:
            font = ImageFont.truetype(fp, 36)
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()
    # center text
    bbox = draw.textbbox((0, 0), name, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((W - tw) / 2, y0 + (band_h - th) / 2 - 2), name, fill=(255, 220, 120, 255), font=font)
    return im


def main():
    img_dir = find_img_dir()
    print("img_dir", img_dir)
    OUT.mkdir(parents=True, exist_ok=True)
    for src, (key, name) in MAP.items():
        path = img_dir / src
        if not path.exists():
            print("MISSING", src)
            continue
        im = Image.open(path)
        im = key_crop(im)
        im = fit_card(im)
        if name:
            im = add_label(im, name)
        out = OUT / f"{key}.png"
        im.convert("RGB").save(out, "PNG", optimize=True)
        print("wrote", out.name, im.size)
    print("done", sorted(p.name for p in OUT.glob("*.png")))


if __name__ == "__main__":
    main()
