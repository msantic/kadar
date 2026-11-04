#!/bin/sh
# Makes every app icon file from src-tauri/icons/icon.svg, the one drawing of Kadar's icon: the
# PNG sizes Tauri bundles, icon.icns for the Mac and icon.ico for Windows. Run it after the drawing
# changes: npm run icons. Needs rsvg-convert (brew install librsvg); sips and iconutil come with
# macOS; the .ico comes from the Tauri CLI already in node_modules.
set -e
cd "$(dirname "$0")/.."
icons=src-tauri/icons
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

big="$work/icon-1024.png"
rsvg-convert -w 1024 -h 1024 "$icons/icon.svg" -o "$big"

sips -z 512 512 "$big" --out "$icons/icon.png" >/dev/null
sips -z 256 256 "$big" --out "$icons/128x128@2x.png" >/dev/null
sips -z 128 128 "$big" --out "$icons/128x128.png" >/dev/null
sips -z 32 32 "$big" --out "$icons/32x32.png" >/dev/null

set_dir="$work/icon.iconset"
mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  sips -z $size $size "$big" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$big" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o "$icons/icon.icns"

# The Tauri CLI makes many files; keep only the Windows icon. It reads the same 1024 px picture,
# so every system shows the same pixels.
npx --no-install tauri icon "$big" -o "$work/tauri" >/dev/null 2>&1
cp "$work/tauri/icon.ico" "$icons/icon.ico"

echo "Icons made from $icons/icon.svg."
