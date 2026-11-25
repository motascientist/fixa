#!/usr/bin/env bash
# Builds the signed Fixa APK. Run from Git Bash or any POSIX shell:  bash android/build.sh
#
# Tools: JDK 17, Android SDK (platform 34 + build-tools 34.0.0) and Gradle 8.7.
#   Looked up in %LOCALAPPDATA%\Android by default; override with FIXA_TOOLS.
# Signing: FIXA_KEYSTORE (path to the .keystore) and FIXA_KEYSTORE_PASSWORD, from the environment
#   or from a .env file pointed to by FIXA_ENV (a relative keystore path in that file is relative to the file).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="${FIXA_TOOLS:-${LOCALAPPDATA:-$HOME}/Android}"

if [ -n "${FIXA_ENV:-}" ]; then
  BASE="$(cd "$(dirname "$FIXA_ENV")" && pwd)"
  : "${FIXA_KEYSTORE:=$(grep '^FIXA_KEYSTORE=' "$FIXA_ENV" | cut -d= -f2-)}"
  : "${FIXA_KEYSTORE_PASSWORD:=$(grep '^FIXA_KEYSTORE_PASSWORD=' "$FIXA_ENV" | cut -d= -f2-)}"
  case "$FIXA_KEYSTORE" in /*|?:*) ;; *) FIXA_KEYSTORE="$BASE/$FIXA_KEYSTORE" ;; esac
fi
[ -f "${FIXA_KEYSTORE:-}" ] || { echo "Set FIXA_KEYSTORE and FIXA_KEYSTORE_PASSWORD (or FIXA_ENV). See android/README.md"; exit 1; }

topath() { command -v cygpath >/dev/null && cygpath -w "$1" || echo "$1"; }
export JAVA_HOME="$(topath "$(ls -d "$TOOLS"/jdk-17* | head -1)")"
export ANDROID_HOME="$(topath "$TOOLS/Sdk")"
export FIXA_KEYSTORE="$(topath "$FIXA_KEYSTORE")"
export FIXA_KEYSTORE_PASSWORD

GRADLE="$TOOLS/gradle-8.7/bin/gradle"; [ -f "$GRADLE.bat" ] && GRADLE="$GRADLE.bat"
SIGNER="$TOOLS/Sdk/build-tools/34.0.0/apksigner"; [ -f "$SIGNER.bat" ] && SIGNER="$SIGNER.bat"

cd "$HERE"
"$GRADLE" assembleRelease --console=plain -q
VERSION="$(grep versionName app/build.gradle | sed "s/.*'\(.*\)'.*/\1/")"
mkdir -p out
cp app/build/outputs/apk/release/app-release.apk "out/fixa-$VERSION.apk"
"$SIGNER" verify "$(topath "out/fixa-$VERSION.apk")" && echo "Signed APK: $HERE/out/fixa-$VERSION.apk"
