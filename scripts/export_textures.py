"""Export generated session images into public/textures as engine-ready PNGs."""
from PIL import Image
from pathlib import Path

SESSION_MARK = "019f7571"
OUT = Path(__file__).resolve().parents[1] / "public" / "textures"
SIZE = 512


def find_img_dir() -> Path:
    root = Path(r"C:\Users\hencter\.grok\sessions")
    hits = [p for p in root.rglob("16.jpg") if SESSION_MARK in str(p)]
    if hits:
        return hits[0].parent
    hits = sorted(root.rglob("16.jpg"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not hits:
        raise SystemExit("No session images found")
    return hits[0].parent


def save_png(img_dir: Path, src_name: str, dst_name: str, crop_center: float | None = None):
    im = Image.open(img_dir / src_name).convert("RGB")
    if crop_center:
        w, h = im.size
        m = crop_center
        left = int(w * (1 - m) / 2)
        top = int(h * (1 - m) / 2)
        im = im.crop((left, top, left + int(w * m), top + int(h * m)))
    im = im.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    path = OUT / dst_name
    im.save(path, "PNG", optimize=True)
    print(f"wrote {path.name} {im.size} from {src_name}")


def main():
    img_dir = find_img_dir()
    print("img_dir", img_dir)
    OUT.mkdir(parents=True, exist_ok=True)

    # Scene / board
    save_png(img_dir, "6.jpg", "ground.png")
    save_png(img_dir, "1.jpg", "board_felt.png")
    save_png(img_dir, "13.jpg", "board_rim.png")
    save_png(img_dir, "14.jpg", "tile_base.png")
    save_png(img_dir, "2.jpg", "tower_glass.png")
    save_png(img_dir, "4.jpg", "hq_cladding.png")

    # Token / prop materials (tint-friendly light values)
    save_png(img_dir, "8.jpg", "mat_plastic.png", crop_center=0.72)
    save_png(img_dir, "9.jpg", "mat_metal.png")
    save_png(img_dir, "11.jpg", "mat_felt.png", crop_center=0.85)
    save_png(img_dir, "16.jpg", "mat_wood.png")
    save_png(img_dir, "7.jpg", "mat_panel.png")
    save_png(img_dir, "10.jpg", "mat_rubber.png")
    save_png(img_dir, "15.jpg", "mat_tech.png")

    print("files:", sorted(p.name for p in OUT.glob("*.png")))


if __name__ == "__main__":
    main()
