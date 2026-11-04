"""Generate the artwork that sits *behind* an HTML banner or social card.

Banners and social photos keep their text in HTML: the image model misspells
words and ignores requested pixel sizes, while a banner must say exactly the
right thing at exactly 820x312. So only the backdrop is generated here; a CSS
`screenshot at exact size` over it keeps text crisp.

The generated frame never matches the target aspect ratio exactly, which is
fine — CSS `background-size: cover` crops it. Never size the banner from the
returned image.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ninerouter

RATIOS = [("1:1", 1.0), ("4:3", 4 / 3), ("3:4", 3 / 4), ("16:9", 16 / 9), ("9:16", 9 / 16)]

NO_TEXT = ("absolutely no text, no letters, no words, no numbers, no logos, "
           "no watermarks — pure artwork only")

TEXT_ZONE = {
    "left": "keep the left two thirds visually calm and low-contrast so caption text stays readable",
    "right": "keep the right two thirds visually calm and low-contrast so caption text stays readable",
    "center": "keep the central band visually calm and low-contrast so caption text stays readable",
    "none": "even visual weight across the whole frame, no reserved text area",
}


def best_ratio(width, height):
    """Closest supported aspect ratio to the target frame."""
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be positive")
    want = width / height
    return min(RATIOS, key=lambda pair: abs(pair[1] - want))[0]


def build_prompt(subject, style=None, palette=None, mood=None, text_zone="center"):
    parts = [f"{subject.strip().rstrip('.')}"]
    if style:
        parts.append(f"{style} art direction")
    if palette:
        parts.append(f"colour palette: {palette}")
    if mood:
        parts.append(f"mood: {mood}")
    parts.append("full-bleed background artwork, edge-to-edge, no border, no frame")
    parts.append(TEXT_ZONE.get(text_zone, TEXT_ZONE["center"]))
    parts.append(NO_TEXT)
    return ". ".join(parts)


def render(width, height, subject, output, style=None, palette=None, mood=None,
           text_zone="center", model=None, base=None, key=None):
    """Render a backdrop for a width x height target and return the written path."""
    ratio = best_ratio(width, height)
    prompt = build_prompt(subject, style, palette, mood, text_zone)
    print(f"Backdrop for {width}x{height} -> ratio {ratio}")
    print(f"Prompt: {prompt[:160]}{'...' if len(prompt) > 160 else ''}")
    saved = ninerouter.render_image(
        prompt, output, aspect_ratio=ratio,
        model=model, base=base, key=key,
    )
    print(f"Backdrop saved: {saved}  (crop to {width}x{height} with CSS cover)")
    return Path(saved)


def main():
    p = argparse.ArgumentParser(
        description="Generate a CSS backdrop for a banner/social card (text stays in HTML)")
    p.add_argument("subject", help="What the artwork should show")
    p.add_argument("-o", "--output", required=True, help="Output image path")
    p.add_argument("-W", "--width", type=int, required=True, help="Target width in px")
    p.add_argument("-H", "--height", type=int, required=True, help="Target height in px")
    p.add_argument("--style", help="Art direction, e.g. 'minimal gradient'")
    p.add_argument("--palette", help="Colour palette, hex or names")
    p.add_argument("--mood", help="e.g. calm, energetic, premium")
    p.add_argument("--text-zone", default="center", choices=sorted(TEXT_ZONE),
                   help="Where the caption will sit (default: center)")
    p.add_argument("--model", help="Override the image model")
    p.add_argument("--base", help="Override the gateway base URL")
    p.add_argument("--key", help="Override the gateway API key")
    a = p.parse_args()
    render(a.width, a.height, a.subject, a.output, style=a.style,
           palette=a.palette, mood=a.mood, text_zone=a.text_zone,
           model=a.model, base=a.base, key=a.key)


if __name__ == "__main__":
    main()