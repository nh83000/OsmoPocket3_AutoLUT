# AutoLUT + Convertisseur YouTube

Projet commun réunissant deux outils locaux :
- **AutoLUT** — applique des LUT DJI Osmo Pocket 3 (ou Presetpro) à des vidéos, entièrement dans le navigateur
- **Convertisseur YouTube** — convertit un lien YouTube en MP3 ou MP4 via un petit serveur Flask local

Une seule commande lance les deux : AutoLUT s'affiche en page d'accueil, avec un bouton pour passer au Convertisseur.

## Prérequis

- [Node.js](https://nodejs.org/) (pour builder AutoLUT)
- Python 3.9 ou plus récent
- [ffmpeg](https://ffmpeg.org/download.html) installé et accessible dans le PATH (`ffmpeg -version` doit fonctionner)

## Installation

```bash
npm install
npm run build

python -m venv venv
venv\Scripts\activate      # Windows
source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

## Lancement

```bash
python app.py
```

Puis ouvrir `http://localhost:5000` : AutoLUT s'affiche en page d'accueil, avec un bouton vers le Convertisseur (`/convertisseur/`).

## AutoLUT

Dépose une ou plusieurs vidéos, choisis un LUT (préréglages DJI Osmo Pocket 3 ou Presetpro), ajuste l'intensité, prévisualise, puis lance le traitement. Tout se passe dans le navigateur, rien n'est envoyé sur internet.

Aussi disponible en ligne, en version autonome sans le Convertisseur : déploiement automatique sur GitHub Pages à chaque push sur `main`.

## Convertisseur YouTube

1. Coller un lien YouTube (vidéo unique, pas de playlist) — un bouton 📋 permet de coller directement depuis le presse-papier
2. Cliquer sur « Vérifier » pour afficher un aperçu (miniature + titre) de la vidéo
3. Choisir MP3 ou MP4
4. Cliquer sur Convertir et attendre la fin du traitement (barre de progression)
5. Cliquer sur le bouton de téléchargement une fois la conversion terminée

### Limites connues

- Une seule vidéo à la fois, pas de playlist
- Pas de choix de qualité/résolution (toujours la meilleure disponible)
- Application mono-utilisateur, prévue pour un usage local uniquement

## Tests

AutoLUT dispose de tests unitaires Vitest (parsing des LUT, espace colorimétrique) :

```bash
npm test
```

Le Convertisseur n'a pas de suite automatisée (projet volontairement petit) — validation manuelle :
- AutoLUT : traitement d'une vidéo réelle avec un LUT intégré
- Conversion MP3 et MP4 sur une vidéo YouTube publique réelle
- URL invalide → message d'erreur affiché sans plantage
- Vidéo privée/indisponible → statut d'erreur affiché correctement

## Dépannage

Le Convertisseur configure automatiquement yt-dlp pour utiliser Node.js comme moteur JavaScript, nécessaire pour résoudre certains défis anti-bot de YouTube (évite les erreurs `HTTP Error 403: Forbidden` sur certains formats). Le script officiel de résolution fourni par yt-dlp est téléchargé depuis GitHub au premier lancement, puis mis en cache localement. Aucune configuration manuelle supplémentaire n'est nécessaire au-delà d'avoir Node.js installé et accessible dans le PATH.

Si `python app.py` affiche une erreur au sujet de `dist/` introuvable, lancez `npm install && npm run build` avant de relancer.
