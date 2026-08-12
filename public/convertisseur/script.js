const IS_LOCAL =
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") &&
  window.location.port === "5000";
const API_BASE = IS_LOCAL ? "" : "https://convertisseur-youtube-krhs.onrender.com";

const passwordRow = document.getElementById("password-row");
const passwordInput = document.getElementById("password-input");

if (!IS_LOCAL) {
  passwordRow.hidden = false;
  passwordInput.value = sessionStorage.getItem("convertisseurPassword") || "";
  passwordInput.addEventListener("input", () => {
    sessionStorage.setItem("convertisseurPassword", passwordInput.value);
  });
}

function authHeaders() {
  return IS_LOCAL ? {} : { "X-Password": passwordInput.value };
}

const form = document.getElementById("convert-form");
const urlInput = document.getElementById("url-input");
const pasteButton = document.getElementById("paste-button");
const verifyButton = document.getElementById("verify-button");
const previewArea = document.getElementById("preview-area");
const convertSection = document.getElementById("convert-section");
const statusArea = document.getElementById("status-area");
const submitButton = form.querySelector('button[type="submit"]');

let pollTimer = null;
let failedPolls = 0;

pasteButton.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text.trim();
      resetVerification();
    }
  } catch (err) {
    // Presse-papier inaccessible (permission refusée) : on ignore silencieusement.
  }
});

urlInput.addEventListener("input", () => {
  resetVerification();
});

function resetVerification() {
  stopPolling();
  previewArea.innerHTML = "";
  convertSection.hidden = true;
  statusArea.innerHTML = "";
}

verifyButton.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  resetVerification();

  if (!url) {
    return;
  }

  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}/api/preview?url=${encodeURIComponent(url)}`, {
      headers: authHeaders(),
    });
    data = await response.json();
  } catch (err) {
    previewArea.innerHTML = `<p class="error">Impossible de contacter le serveur.</p>`;
    return;
  }

  if (!response.ok) {
    previewArea.innerHTML = `<p class="error">${data.error}</p>`;
    return;
  }

  showPreview(data.title, data.thumbnail);
  convertSection.hidden = false;
});

function showPreview(title, thumbnail) {
  previewArea.innerHTML = "";

  const card = document.createElement("div");
  card.className = "preview-card";

  const thumb = document.createElement("div");
  thumb.className = "preview-thumb";
  if (thumbnail) {
    thumb.style.backgroundImage = `url("${thumbnail}")`;
  }
  card.appendChild(thumb);

  const titleEl = document.createElement("div");
  titleEl.className = "preview-title";
  titleEl.textContent = title || "";
  card.appendChild(titleEl);

  previewArea.appendChild(card);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  stopPolling();
  statusArea.innerHTML = "";
  submitButton.disabled = true;

  const url = urlInput.value.trim();
  const format = form.elements["format"].value;

  let response;
  let data;
  try {
    response = await fetch(`${API_BASE}/api/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ url, format }),
    });
    data = await response.json();
  } catch (err) {
    showError("Impossible de contacter le serveur.");
    submitButton.disabled = false;
    return;
  }

  if (!response.ok) {
    showError(data.error);
    submitButton.disabled = false;
    return;
  }

  failedPolls = 0;
  pollStatus(data.job_id);
});

function pollStatus(jobId) {
  pollTimer = setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/status/${jobId}`, {
        headers: authHeaders(),
      });
      const data = await response.json();

      if (!response.ok) {
        showError(data.error);
        stopPolling();
        submitButton.disabled = false;
        return;
      }

      failedPolls = 0;

      if (data.status === "error") {
        showError(data.error_message);
        stopPolling();
        submitButton.disabled = false;
        return;
      }

      if (data.status === "done") {
        stopPolling();
        showSuccess(jobId, data.filename);
        submitButton.disabled = false;
        return;
      }

      showProgress(data.status, data.progress);
    } catch (err) {
      failedPolls += 1;
      if (failedPolls >= 3) {
        showError("Connexion perdue avec le serveur.");
        stopPolling();
        submitButton.disabled = false;
      }
    }
  }, 1000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function showProgress(status, progress) {
  const label = status === "downloading" ? "Téléchargement" : "Conversion";
  statusArea.innerHTML = `
    <div class="progress-track"><div class="progress-fill" style="width: ${progress}%"></div></div>
    <div class="progress-label"><span>${label}...</span><span>${progress}%</span></div>
  `;
}

function showSuccess(jobId, filename) {
  statusArea.innerHTML = `
    <div class="success-state">
      <div class="check-circle">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>
      </div>
      <p class="success-title">C'est prêt !</p>
      <p class="success-filename">${filename}</p>
      <a href="#" id="download-link" class="download-btn">⬇ Télécharger</a>
    </div>
  `;
  const downloadLink = document.getElementById("download-link");

  if (IS_LOCAL) {
    downloadLink.href = `/api/download/${jobId}`;
    downloadLink.addEventListener("click", () => {
      statusArea.innerHTML = "<p>Fichier téléchargé.</p>";
    });
    return;
  }

  downloadLink.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/api/download/${jobId}`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showError(data.error || "Téléchargement impossible.");
        return;
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(blobUrl);
      statusArea.innerHTML = "<p>Fichier téléchargé.</p>";
    } catch (err) {
      showError("Téléchargement impossible.");
    }
  });
}

function showError(message) {
  statusArea.innerHTML = `<p class="error">${message}</p>`;
}
