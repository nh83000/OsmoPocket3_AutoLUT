# AutoLUT + Convertisseur YouTube

AutoLUT applique des LUT (DJI Osmo Pocket 3 / Presetpro) à des vidéos, direct dans le navigateur. Un convertisseur YouTube → MP3/MP4 est intégré.

## Lancer en local

```bash
npm install && npm run build
pip install -r requirements.txt
python app.py
```

Ouvre ensuite `http://localhost:5000`.

## Appli de bureau

Un installeur Windows/Mac tout-en-un est dispo dans les [Releases](https://github.com/nh83000/OsmoPocket3_AutoLUT/releases) — aucun prérequis à installer.

## À savoir

- Convertisseur : une vidéo à la fois, toujours en meilleure qualité dispo
- ffmpeg + Node.js doivent être dans le PATH si tu lances depuis les sources
