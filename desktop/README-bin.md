# Binaires portables embarqués

Ce dossier (`desktop/bin/`) contient des binaires tiers téléchargés, volontairement exclus de git (trop volumineux). Pour les régénérer :

## Windows (`bin/win/`)
- `ffmpeg.exe` : depuis https://www.gyan.dev/ffmpeg/builds/ (build "essentials", licence GPL/LGPL selon la build)
- `node.exe` : depuis https://nodejs.org/dist/ (archive `node-vXX.X.X-win-x64.zip`, binaire `node.exe` à la racine de l'archive)

## macOS (`bin/mac/`)
- `ffmpeg` : depuis https://evermeet.cx/ffmpeg/ (build statique macOS) ou https://www.osxexperts.net/
- `node` : depuis https://nodejs.org/dist/ (archive `node-vXX.X.X-darwin-x64.tar.gz` ou `-arm64` selon l'architecture cible, binaire `bin/node`)

Ces téléchargements sont automatisés dans le workflow CI (`.github/workflows/build-desktop.yml`, Task 5 du plan) — cette procédure manuelle sert uniquement au développement/test local.

Voir aussi `THIRD-PARTY-NOTICES.md` pour les mentions de licence requises par la distribution de ces binaires.
