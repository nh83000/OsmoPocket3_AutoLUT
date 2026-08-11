import mimetypes
import os
import shutil
import sys
import urllib.parse

from flask import Flask, Response, jsonify, request, send_from_directory

from convertisseur import converter

app = Flask(__name__, static_folder=None)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AUTOLUT_DIST_DIR = os.path.join(BASE_DIR, "dist")
CONVERTISSEUR_STATIC_DIR = os.path.join(BASE_DIR, "convertisseur", "static")


def check_ffmpeg():
    if shutil.which("ffmpeg") is None:
        print("Erreur : ffmpeg est introuvable dans le PATH. Installez-le avant de lancer le serveur.")
        sys.exit(1)


def check_autolut_build():
    if not os.path.isdir(AUTOLUT_DIST_DIR):
        print("Erreur : le dossier 'dist/' est introuvable. Lancez d'abord `npm install && npm run build`.")
        sys.exit(1)


def check_convertisseur_static():
    if not os.path.isdir(CONVERTISSEUR_STATIC_DIR):
        print("Erreur : le dossier 'convertisseur/static/' est introuvable.")
        sys.exit(1)


@app.route("/")
def index():
    return send_from_directory(AUTOLUT_DIST_DIR, "index.html")


@app.route("/<path:filename>")
def autolut_assets(filename):
    # Les routes /convertisseur/... et /api/... ci-dessous ont des segments
    # statiques plus spécifiques : Werkzeug les fait toujours matcher en
    # priorité, donc ce fourre-tout ne reçoit que les vraies requêtes d'assets AutoLUT.
    return send_from_directory(AUTOLUT_DIST_DIR, filename)


@app.route("/convertisseur/")
def convertisseur_index():
    return send_from_directory(CONVERTISSEUR_STATIC_DIR, "index.html")


@app.route("/convertisseur/<path:filename>")
def convertisseur_assets(filename):
    return send_from_directory(CONVERTISSEUR_STATIC_DIR, filename)


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


if __name__ == "__main__":
    check_ffmpeg()
    check_autolut_build()
    check_convertisseur_static()
    converter.cleanup_old_downloads()
    app.run(debug=True, port=5000)
