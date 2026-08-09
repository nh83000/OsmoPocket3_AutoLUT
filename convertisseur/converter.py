import os
import re
import threading
import time
import uuid

import yt_dlp

YOUTUBE_URL_RE = re.compile(
    r'^https?://(www\.)?(youtube\.com/watch\?v=|youtu\.be/)[\w-]+'
)

DOWNLOAD_DIR = "downloads"

JS_RUNTIME_OPTS = {
    "js_runtimes": {"deno": {}, "node": {}},
    "remote_components": {"ejs:github"},
}

jobs = {}
jobs_lock = threading.Lock()


def is_youtube_url(url):
    return bool(YOUTUBE_URL_RE.match(url))


def create_job():
    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "status": "downloading",
            "progress": 0,
            "error_message": None,
            "filename": None,
        }
    return job_id


def get_job(job_id):
    with jobs_lock:
        return jobs.get(job_id)


def cleanup_old_downloads(max_age_seconds=24 * 60 * 60):
    if not os.path.isdir(DOWNLOAD_DIR):
        return
    now = time.time()
    for name in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, name)
        if os.path.isfile(path) and now - os.path.getmtime(path) > max_age_seconds:
            os.remove(path)


def get_preview(url):
    ydl_opts = {
        "quiet": True,
        "noplaylist": True,
        **JS_RUNTIME_OPTS,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return {"title": info.get("title"), "thumbnail": info.get("thumbnail")}


def _progress_hook(job_id):
    # Only ever updates progress while a stream is still downloading. For an
    # MP4 merge, yt-dlp downloads video and audio as two separate streams,
    # each running its own 0->100 "downloading" sequence, so the raw
    # per-event ratio is not monotonic across the whole job. Clamp with
    # max() so the value shown to a caller never jumps backward. Status is
    # deliberately never touched here -- see _postprocessor_hook.
    def hook(d):
        if d["status"] != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        downloaded = d.get("downloaded_bytes", 0)
        if not total:
            return
        pct = int(downloaded / total * 100)
        with jobs_lock:
            job = jobs[job_id]
            job["progress"] = max(job["progress"], pct)
    return hook


def _postprocessor_hook(job_id):
    # yt-dlp only ever starts postprocessing (merging streams, extracting
    # audio, or just moving the finished file into place) after every
    # requested download stream for the job has completed. So "started" is
    # a reliable, single-source-of-truth signal for "now converting" that
    # doesn't require guessing how many streams a given job will have.
    def hook(d):
        if d["status"] != "started":
            return
        with jobs_lock:
            job = jobs[job_id]
            job["status"] = "converting"
            job["progress"] = 100
    return hook


INVALID_FILENAME_CHARS_RE = re.compile(r'[\\/:*?"<>|]')


def _sanitize_filename(title):
    if not title:
        return ""
    cleaned = INVALID_FILENAME_CHARS_RE.sub(" ", title)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:150].rstrip(". ")


def run_conversion(job_id, url, fmt):
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    outtmpl = os.path.join(DOWNLOAD_DIR, f"{job_id}.%(ext)s")

    if fmt == "mp3":
        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": outtmpl,
            "progress_hooks": [_progress_hook(job_id)],
            "postprocessor_hooks": [_postprocessor_hook(job_id)],
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "quiet": True,
            "noplaylist": True,
            **JS_RUNTIME_OPTS,
        }
    else:
        ydl_opts = {
            "format": "bestvideo+bestaudio/best",
            "outtmpl": outtmpl,
            "progress_hooks": [_progress_hook(job_id)],
            "postprocessor_hooks": [_postprocessor_hook(job_id)],
            "merge_output_format": "mp4",
            "quiet": True,
            "noplaylist": True,
            **JS_RUNTIME_OPTS,
        }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            # info['ext']/info['filepath'] at the top level can be stale
            # (they reflect the pre-postprocessing source format, e.g.
            # "webm" instead of "mp3", or the merge target even when no
            # merge actually happened). The per-file entries in
            # requested_downloads are the ones yt-dlp itself mutates while
            # downloading/postprocessing, so they reflect the true final
            # extension and path on disk.
            downloads = info.get("requested_downloads") or [info]
            final_path = downloads[0].get("filepath") or ydl.prepare_filename(info)

            # Rename from the technical job-id-based name to the video's title
            # once conversion succeeds; fall back to the technical name if
            # sanitizing/renaming isn't possible (empty title, or a transient
            # OS-level failure like a file lock).
            sanitized_title = _sanitize_filename(info.get("title"))
            if sanitized_title:
                ext = os.path.splitext(final_path)[1]
                target_path = os.path.join(DOWNLOAD_DIR, f"{sanitized_title}{ext}")
                if os.path.exists(target_path):
                    target_path = os.path.join(DOWNLOAD_DIR, f"{sanitized_title} ({job_id[:8]}){ext}")
                try:
                    os.replace(final_path, target_path)
                    final_path = target_path
                except OSError:
                    pass
        with jobs_lock:
            jobs[job_id]["status"] = "done"
            jobs[job_id]["progress"] = 100
            jobs[job_id]["filename"] = os.path.basename(final_path)
    except Exception as e:
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error_message"] = str(e)


def start_conversion(url, fmt):
    job_id = create_job()
    thread = threading.Thread(target=run_conversion, args=(job_id, url, fmt), daemon=True)
    thread.start()
    return job_id
