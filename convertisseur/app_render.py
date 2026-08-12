import mimetypes
import os
import secrets
import sys
import urllib.parse

from flask import Flask, Response, jsonify, request
from flask_cors import CORS

from convertisseur import converter

ALLOWED_ORIGIN = "https://nh83000.github.io"
PASSWORD_ENV_VAR = "CONVERTISSEUR_PASSWORD"
# La vérification ci-dessous (compter puis créer le job) n'est pas atomique :
# jobs_lock est relâché entre le comptage et converter.start_conversion(), qui
# le réacquiert séparément. C'est sans risque uniquement parce que le déploiement
# Render tourne avec un seul worker gunicorn (--workers 1 --threads 1, voir
# convertisseur/Dockerfile) : une seule requête HTTP est traitée à la fois, donc
# aucune vraie concurrence n'existe pour déclencher la course. Si le nombre de
# workers/threads change un jour, cette protection doit être revue (verrou
# réentrant dans converter.py, ou primitive d'acquisition atomique).
MAX_CONCURRENT_CONVERSIONS = 2

app = Flask(__name__)
CORS(
    app,
    origins=[ALLOWED_ORIGIN],
    allow_headers=["Content-Type", "X-Password"],
    methods=["GET", "POST", "OPTIONS"],
)


def check_ffmpeg():
    import shutil
    if shutil.which("ffmpeg") is None:
        print("Erreur : ffmpeg est introuvable dans le PATH.")
        sys.exit(1)


@app.before_request
def check_password():
    if request.method == "OPTIONS" or request.path == "/":
        return
    expected = os.environ.get(PASSWORD_ENV_VAR)
    if not expected:
        return jsonify({"error": "Serveur mal configure (mot de passe manquant)."}), 500
    provided = request.headers.get("X-Password", "")
    if not secrets.compare_digest(provided, expected):
        return jsonify({"error": "Mot de passe incorrect ou manquant."}), 401


@app.route("/")
def health():
    return "OK"


@app.route("/api/convert", methods=["POST"])
def convert():
    data = request.get_json(force=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Requête invalide."}), 400
    raw_url = data.get("url")
    url = raw_url.strip() if isinstance(raw_url, str) else ""
    fmt = data.get("format", "")

    if fmt not in ("mp3", "mp4"):
        return jsonify({"error": "Format invalide."}), 400

    if not converter.is_youtube_url(url):
        return jsonify({"error": "Ce n'est pas un lien YouTube valide."}), 400

    with converter.jobs_lock:
        active = sum(1 for job in converter.jobs.values() if job["status"] in ("downloading", "converting"))
    if active >= MAX_CONCURRENT_CONVERSIONS:
        return jsonify({"error": "Trop de conversions en cours, reessayez dans quelques instants."}), 429

    job_id = converter.start_conversion(url, fmt)
    return jsonify({"job_id": job_id})


@app.route("/api/preview")
def preview():
    url = request.args.get("url", "").strip()
    if not converter.is_youtube_url(url):
        return jsonify({"error": "Ce n'est pas un lien YouTube valide."}), 400
    try:
        info = converter.get_preview(url)
    except Exception:
        return jsonify({"error": "Vidéo introuvable ou indisponible."}), 404
    return jsonify(info)


@app.route("/api/status/<job_id>")
def status(job_id):
    job = converter.get_job(job_id)
    if job is None:
        return jsonify({"error": "Tâche inconnue."}), 404
    return jsonify({
        "status": job["status"],
        "progress": job["progress"],
        "error_message": job["error_message"],
        "filename": job["filename"],
    })


@app.route("/api/download/<job_id>")
def download(job_id):
    job = converter.get_job(job_id)
    if job is None or job["status"] != "done":
        return jsonify({"error": "Fichier non disponible."}), 404

    path = os.path.join(converter.DOWNLOAD_DIR, job["filename"])
    if not os.path.exists(path):
        return jsonify({"error": "Fichier non disponible."}), 404

    mimetype = mimetypes.guess_type(job["filename"])[0] or "application/octet-stream"

    def generate():
        with open(path, "rb") as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                yield chunk
        try:
            os.remove(path)
        except OSError:
            pass

    filename = job["filename"]
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii").strip() or "download"
    encoded_filename = urllib.parse.quote(filename)
    content_disposition = f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded_filename}'

    return Response(
        generate(),
        mimetype=mimetype,
        headers={"Content-Disposition": content_disposition},
    )


check_ffmpeg()
converter.cleanup_old_downloads()
