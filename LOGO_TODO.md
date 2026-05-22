# Logo Replacement Instructions

The current `public/team-haim-logo.png` was generated from the hand-drawn SVG.
To replace it with **your actual uploaded TH monogram image**, run these commands
in the project root after saving your image file as `TH.png`:

## Steps

1. **Copy your image into public/**
   ```bash
   cp /path/to/your/TH.png public/team-haim-logo.png
   ```

2. **Regenerate all icon sizes** (requires ImageMagick — install with `brew install imagemagick` on Mac or `apt install imagemagick` on Linux):
   ```bash
   magick public/team-haim-logo.png -resize 32x32   public/icon-32x32.png
   magick public/team-haim-logo.png -resize 192x192 public/icon-192x192.png
   magick public/team-haim-logo.png -resize 512x512 public/icon-512x512.png
   magick public/team-haim-logo.png -resize 180x180 public/apple-icon.png
   ```

   Or with **sharp-cli** (`npm install -g sharp-cli`):
   ```bash
   for size in 32 192 512; do
     sharp -i public/team-haim-logo.png -o public/icon-${size}x${size}.png resize $size $size
   done
   sharp -i public/team-haim-logo.png -o public/apple-icon.png resize 180 180
   ```

3. **Clear the Next.js cache and restart**:
   ```bash
   rm -rf .next
   npm run dev
   ```

4. **Force-refresh your browser** with `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows/Linux)
   to bypass cached assets.

5. **Commit the new images**:
   ```bash
   git add public/team-haim-logo.png public/icon-*.png public/apple-icon.png
   git commit -m "chore: replace logo with actual TH monogram image"
   git push
   ```

> **Note:** The `?v=3` query strings in the code already bust the cache. Once you
> drop in the new PNG files, users will see the updated logo without any code changes.
