const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const SERVER_URL = "http://127.0.0.1:5000/";

let backendProcess = null;
let mainWindow = null;

function backendExecutablePath() {
  const exeName = process.platform === "win32" ? "app.exe" : "app";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "backend", exeName);
  }
  // Mode developpement : utilise le build PyInstaller produit en local (Task 1).
  return path.join(__dirname, "backend", "app", exeName);
}

function bundledBinDir() {
  const platformDir = process.platform === "win32" ? "win" : "mac";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", platformDir);
  }
  return path.join(__dirname, "bin", platformDir);
}

function startBackend() {
  const exePath = backendExecutablePath();
  const binDir = bundledBinDir();
  backendProcess = spawn(exePath, [], {
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    },
  });
  backendProcess.on("error", (err) => {
    console.error("Le backend n'a pas pu demarrer :", err);
  });
  backendProcess.on("exit", (code) => {
    console.log("Backend arrete, code :", code);
  });
}

function waitForServer(callback, attemptsLeft = 60) {
  http
    .get(SERVER_URL, () => callback())
    .on("error", () => {
      if (attemptsLeft <= 0) {
        console.error("Le serveur local n'a jamais repondu.");
        return;
      }
      setTimeout(() => waitForServer(callback, attemptsLeft - 1), 500);
    });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
  });
  waitForServer(() => {
    mainWindow.loadURL(SERVER_URL);
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});
