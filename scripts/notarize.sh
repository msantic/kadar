#!/bin/bash
# Makes a Kadar installer that opens on any Mac without a warning: Apple checks ("notarizes")
# the built app, the approval is stapled to it, and a disk image is made, signed, checked and
# stapled the same way. Run after `npm run build`.
#
# Needs the notary login in the keychain once (see docs/development.md, "Share Kadar"):
#   xcrun notarytool store-credentials kadar-notary --apple-id <id> --team-id FC2M54RD3H
#
# Result: src-tauri/target/release/bundle/share/Kadar-<version>.dmg

set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE="kadar-notary"
IDENTITY="Developer ID Application: Prelako d.o.o. (FC2M54RD3H)"
APP="src-tauri/target/release/bundle/macos/Kadar.app"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
OUT="src-tauri/target/release/bundle/share"
DMG="$OUT/Kadar-$VERSION.dmg"

[ -d "$APP" ] || { echo "No built app. Run npm run build first."; exit 1; }
rm -rf "$OUT" && mkdir -p "$OUT"

echo "==> Apple checks the app (a few minutes)"
ditto -c -k --keepParent "$APP" "$OUT/Kadar.zip"
xcrun notarytool submit "$OUT/Kadar.zip" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$APP"
rm "$OUT/Kadar.zip"

echo "==> Disk image with the checked app and a link to Applications"
STAGE="$OUT/stage"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/Kadar.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Kadar" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
rm -rf "$STAGE"
codesign --sign "$IDENTITY" --timestamp "$DMG"

echo "==> Apple checks the disk image"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"

echo "==> Final check, as a friend's Mac sees it"
spctl -a -vv -t open --context context:primary-signature "$DMG"
spctl -a -vv "$APP"
echo "Ready to share: $DMG"
