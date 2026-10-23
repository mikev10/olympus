# Olympus logo

The logo is the word **OLYMPUS** in capitals. Two letters are drawn by hand:

- **The O is the seal.** It is a closed ring with one green stone set from 12 to 3 o'clock. Straight joints separate the stone from the ring. The O also serves as the icon.
- **The M is the summit.** It has a low left peak and a full-height right peak. It is ink only.

All other letters are Outfit Bold, converted to outlines, with 0.09em tracking. The M sits 0.09em closer to the Y than the font would place it.

## Files

| File | Use |
|---|---|
| `wordmark-ink.svg` | Wordmark on light backgrounds |
| `wordmark-white.svg` | Wordmark on dark backgrounds |
| `mark-ink.svg`, `mark-white.svg` | The O alone, transparent background |
| `mark-tile.svg` | The O on an ink square, for avatars |
| `mark-512.png`, `mark-180.png` | Avatar and touch icon, from `mark-tile.svg` |
| `favicon.ico` | 16 and 32px, from `mark-tile.svg` |

`../src/logo.html` shows every variant on ink and on white.

## Rules

- **Green is the stone and nothing else.** `#22C55E` means "passed" across Olympus, and in the logo it appears only as the stone. Never recolour the stone, and never add green anywhere else in the logo.
- **Ink is `#0A0A0B`.** On dark backgrounds the letters and the ring are white. The stone stays green on both.
- **Clear space** around the wordmark is at least the width of the O's ring.
- **Minimum size:** the wordmark at 80px wide, and the O alone at 16px. Below 32px, use `mark-tile` so the ring has a solid background.
- **Do not** set the wordmark in live text, stretch it, rotate the stone, or swap the drawn O or M for font glyphs.
