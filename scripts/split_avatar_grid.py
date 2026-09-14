"""
Split a 3x3 grid source image into 9 individual avatar files.

Each cell in the source grid has a label at the bottom (e.g. "trader-1.png").
The script crops each cell to the avatar artwork only, dropping the label band
so the resulting PNGs are clean for use as AgentCard / AgentDetail avatars.

Usage:
    python scripts/split_avatar_grid.py <source.jpg|png>

Output:
    public/avatars/{niche}/{variant}.png

Grid assumption:
    3 columns x 3 rows.
    Row order (top to bottom): trading, defi, tech
    Column order (left to right): variant 1, 2, 3
"""
import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "public" / "avatars"

NICHES = ["trading", "defi", "tech"]


def detect_label_band_height(image: Image.Image, sample_band: float = 0.18) -> int:
    """Estimate how much of the bottom is occupied by the dark label band so we
    can crop it out. Heuristic: scan the bottom `sample_band` fraction of the
    image for the first row where the average brightness drops below a
    threshold — that's where the label starts."""
    w, h = image.size
    grayscale = image.convert("L")
    pixels = grayscale.load()
    threshold = 60  # dark label background vs lighter avatar artwork
    scan_from = int(h * (1 - sample_band))
    for y in range(scan_from, h - 1):
        # Average brightness across a sample of columns
        sample_cols = [pixels[int(w * c / 16), y] for c in range(16)]
        avg = sum(sample_cols) / len(sample_cols)
        if avg < threshold:
            # First dark row — back off a few pixels for safety
            return max(0, y - 4)
    # No dark band detected — assume bottom 12% is label
    return int(h * 0.88)


def detect_top_padding(image: Image.Image, sample_band: float = 0.25, variance_threshold: int = 18) -> int:
    """Detect top padding to crop off. Scans the top `sample_band` fraction of
    the image and returns the first row that contains actual artwork detail
    (high variance across columns). Falls back to first row with any non-uniform
    pixels. Returns 0 if no padding found."""
    w, h = image.size
    grayscale = image.convert("L")
    pixels = grayscale.load()
    scan_limit = int(h * sample_band)
    for y in range(scan_limit):
        row = [pixels[x, y] for x in range(0, w, max(1, w // 48))]
        variance = max(row) - min(row)
        if variance > variance_threshold:
            return max(0, y - 2)
    return 0


def fill_checkerboard(cell: Image.Image, fill_color: tuple[int, int, int] = (15, 23, 42), gray_max: int = 255, gray_balance: int = 18) -> Image.Image:
    """Replace light-gray checkerboard patterns with a solid theme-matching color.

    The designer's source PNG has a checkerboard of (typically) two gray shades
    to indicate "transparent here" — but the PNG itself stores it as opaque
    light gray, which then renders as a busy pattern around the artwork when
    shipped. We detect any "neutral gray" pixels (R ≈ G ≈ B) within `gray_max`
    brightness and replace them with `fill_color`.

    Trade-off vs the previous corner-sampling approach: this is more aggressive
    (replaces *all* neutral grays, including any gray elements that were
    intentionally part of the artwork), but the avatar style we're working
    with doesn't use gray features, and any leftover gray is more visually
    disruptive than a small amount of over-paint.
    """
    cell = cell.convert("RGBA")
    pixels = cell.load()
    w, h = cell.size
    fill = (*fill_color, 255)

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            is_neutral_gray = (
                abs(r - g) < gray_balance
                and abs(g - b) < gray_balance
                and abs(r - b) < gray_balance
                and r <= gray_max
                and g <= gray_max
                and b <= gray_max
            )
            if is_neutral_gray:
                pixels[x, y] = fill

    return cell


def center_square(cell: Image.Image) -> Image.Image:
    """Center-crop a cell to a square by trimming the longer side equally on both
    ends. Use when the designer's artwork extends across cell boundaries (we
    want a clean 1:1 avatar without slivers of the neighbor character)."""
    w, h = cell.size
    if w == h:
        return cell
    if w > h:
        offset = (w - h) // 2
        return cell.crop((offset, 0, offset + h, h))
    offset = (h - w) // 2
    return cell.crop((0, offset, w, offset + w))


def split_grid(source_path: Path) -> int:
    """Split the grid into 9 PNG files. Returns the number of files written."""
    image = Image.open(source_path).convert("RGBA")
    w, h = image.size
    label_height = detect_label_band_height(image)
    avatar_top = 0
    avatar_bottom = label_height
    cell_w = w // 3
    cell_h = (avatar_bottom - avatar_top) // 3

    print(f"[+] Source: {w}x{h} -- label band height={h - avatar_bottom}px")
    print(f"[+] Raw cell: {cell_w}x{cell_h}")

    written = 0
    for row, niche in enumerate(NICHES):
        for col in range(3):
            variant = col + 1
            left = col * cell_w
            upper = avatar_top + row * cell_h
            right = left + cell_w
            lower = upper + cell_h

            cell = image.crop((left, upper, right, lower))
            # Make 1:1 so avatars don't carry slivers of neighbor characters.
            cell = center_square(cell)
            # Replace any light-gray checkerboard pattern (the designer's
            # "transparency" indicator) with a solid dark theme-matching
            # color so the avatar composites cleanly on the AgentCard's
            # dark background. Without this, the checker pattern leaks
            # through and the avatar looks unfinished.
            cell = fill_checkerboard(cell, fill_color=(15, 23, 42))
            cell = cell.convert("RGBA")

            out_dir = OUTPUT_DIR / niche
            out_dir.mkdir(parents=True, exist_ok=True)
            suffix = "trader" if niche == "trading" else niche
            out_path = out_dir / f"{suffix}-{variant}.png"
            cell.save(out_path, format="PNG", optimize=True)
            written += 1
            print(f"    -> {out_path.relative_to(REPO_ROOT)} ({cell.size[0]}x{cell.size[1]})")

    return written


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 1
    source = Path(sys.argv[1]).resolve()
    if not source.exists():
        print(f"[!] Source not found: {source}", file=sys.stderr)
        return 1
    n = split_grid(source)
    print(f"[OK] Wrote {n} avatar files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

