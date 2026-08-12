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

Aussi disponible en ligne (déploiement automatique sur GitHub Pages à chaque push sur `main`), avec un bouton vers le Convertisseur si celui-ci a été déployé en ligne (voir « Déploiement en ligne (Render) » plus bas) — sinon le bouton mène à une page qui ne pourra pas se connecter à un serveur.

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

## Déploiement en ligne (Render)

Le Convertisseur peut aussi être accessible depuis la version publique GitHub Pages d'AutoLUT (bouton « 🎬 Convertisseur YouTube »), via un serveur hébergé sur [Render](https://render.com). Ces étapes sont à faire une seule fois, manuellement (aucune ne peut être automatisée) :

1. Créer un compte gratuit sur [render.com](https://render.com) (aucune carte bancaire requise pour le palier gratuit).
2. Dans le tableau de bord Render, créer un nouveau **Web Service**, connecter ce repo GitHub (`OsmoPocket3_AutoLUT`).
3. Configuration du service :
   - **Root Directory** : laisser vide (racine du repo)
   - **Dockerfile Path** : `convertisseur/Dockerfile`
   - **Instance Type** : Free
4. Dans l'onglet **Environment** du service, ajouter une variable d'environnement `CONVERTISSEUR_PASSWORD` avec le mot de passe de votre choix.
5. Lancer le déploiement. Une fois terminé, Render fournit une URL du type `https://un-nom.onrender.com`.
6. Mettre à jour `public/convertisseur/script.js` : remplacer `https://TON-SERVICE.onrender.com` par cette URL réelle.
7. `npm run build` puis commit + push — GitHub Pages se redéploie automatiquement avec la bonne URL.

**Limite du palier gratuit :** le service s'endort après 15 minutes d'inactivité ; la requête suivante prend 30 à 60 secondes de plus le temps qu'il se réveille. Normal, pas un bug.
