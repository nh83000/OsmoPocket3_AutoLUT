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
    response = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
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
    response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      const response = await fetch(`/api/status/${jobId}`);
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
      <a href="/api/download/${jobId}" id="download-link" class="download-btn">⬇ Télécharger</a>
    </div>
  `;
  document.getElementById("download-link").addEventListener("click", () => {
    statusArea.innerHTML = "<p>Fichier téléchargé.</p>";
  });
}

function showError(message) {
  statusArea.innerHTML = `<p class="error">${message}</p>`;
}
