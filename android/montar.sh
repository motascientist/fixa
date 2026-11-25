#!/usr/bin/env bash
# Monta o APK do Fixa, assinado. Rodar no Git Bash:  bash android/montar.sh
#
# Ferramentas: JDK 17, Android SDK (plataforma 34 + build-tools 34.0.0) e Gradle 8.7.
#   Por padrão procura em %LOCALAPPDATA%\Android; mude com FIXA_FERRAMENTAS.
# Assinatura: FIXA_KEYSTORE (caminho do .keystore) e FIXA_KEYSTORE_SENHA, no ambiente
#   ou num arquivo .env apontado por FIXA_ENV (caminho relativo no .env vale a partir da pasta do .env).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
FERR="${FIXA_FERRAMENTAS:-$LOCALAPPDATA/Android}"

if [ -n "${FIXA_ENV:-}" ]; then
  BASE="$(cd "$(dirname "$FIXA_ENV")" && pwd)"
  : "${FIXA_KEYSTORE:=$(grep '^FIXA_KEYSTORE=' "$FIXA_ENV" | cut -d= -f2-)}"
  : "${FIXA_KEYSTORE_SENHA:=$(grep '^FIXA_KEYSTORE_SENHA=' "$FIXA_ENV" | cut -d= -f2-)}"
  case "$FIXA_KEYSTORE" in /*|?:*) ;; *) FIXA_KEYSTORE="$BASE/$FIXA_KEYSTORE" ;; esac
fi
[ -f "${FIXA_KEYSTORE:-}" ] || { echo "Defina FIXA_KEYSTORE e FIXA_KEYSTORE_SENHA (ou FIXA_ENV). Ver android/LEIA-ME.md"; exit 1; }

export JAVA_HOME="$(cygpath -w "$(ls -d "$FERR"/jdk-17* | head -1)")"
export ANDROID_HOME="$(cygpath -w "$FERR/Sdk")"
export FIXA_KEYSTORE="$(cygpath -w "$FIXA_KEYSTORE")"
export FIXA_KEYSTORE_SENHA

cd "$AQUI"
"$FERR/gradle-8.7/bin/gradle.bat" assembleRelease --console=plain -q
VERSAO="$(grep versionName app/build.gradle | sed "s/.*'\(.*\)'.*/\1/")"
mkdir -p saida
cp app/build/outputs/apk/release/app-release.apk "saida/fixa-$VERSAO.apk"
"$FERR/Sdk/build-tools/34.0.0/apksigner.bat" verify "$(cygpath -w "saida/fixa-$VERSAO.apk")" && echo "APK assinado: $AQUI/saida/fixa-$VERSAO.apk"
