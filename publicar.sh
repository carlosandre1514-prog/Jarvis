#!/usr/bin/env bash
# Compila o site e copia o resultado para a raiz do repositório,
# que é a pasta que o GitHub Pages publica (Settings → Pages → branch, pasta "/").
set -euo pipefail
cd "$(dirname "$0")"
REPO_NAME="${REPO_NAME:-Jarvis}"

(cd web && npm ci && BASE_PATH="/$REPO_NAME" npx next build)

# remove a publicação anterior e copia a nova
rm -rf _next 404 index.html index.txt 404.html manifest.webmanifest icon-*.png apple-touch-icon.png
cp -r web/out/. .
touch .nojekyll
echo "Pronto. Faça commit e push: o site sai em https://<usuario>.github.io/$REPO_NAME/"
