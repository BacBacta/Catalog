#!/bin/sh
# Chrome pour Lighthouse, en conteneur.
#
# Lighthouse CI 0.15 ne transmet pas `chromeFlags` au lanceur dans tous les
# chemins d'appel : Chrome demarre sans `--no-sandbox`, refuse de tourner en root,
# et l'echec remonte en « Unable to connect to Chrome » — un message qui ne dit
# rien de la cause. On passe donc par CHROME_PATH, qui est toujours respecte.
#
# Le bac a sable est desactive UNIQUEMENT pour le navigateur de mesure, dans un
# conteneur jetable de CI. Rien de ce produit ne tourne ainsi.
set -e

trouver_chrome() {
  if [ -n "$CHROME_REEL" ]; then echo "$CHROME_REEL"; return; fi
  for c in /usr/bin/google-chrome /usr/bin/google-chrome-stable \
           /usr/bin/chromium /usr/bin/chromium-browser \
           /opt/pw-browsers/chromium; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  # Chromium installe par Playwright, dont le nom de repertoire porte la revision.
  for c in "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  echo ""
}

CHROME="$(trouver_chrome)"
if [ -z "$CHROME" ]; then
  echo "aucun Chrome trouve. Posez CHROME_REEL sur le binaire." >&2
  exit 1
fi

exec "$CHROME" --no-sandbox --disable-dev-shm-usage --disable-gpu "$@"
