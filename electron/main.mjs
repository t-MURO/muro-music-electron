import { app, BrowserWindow, dialog, globalShortcut, ipcMain, protocol, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackend } from "./backend.mjs";
import { createLocalFileResponse } from "./fileProtocol.mjs";
import { createKeyFinderService } from "./keyfinder.mjs";
import { registerMediaShortcuts } from "./mediaShortcuts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const developmentAppIcon = path.join(appRoot, "build", "icons", "icon.png");
const developmentKeyFinderBinaries = [
  path.join(appRoot, "build", "keyfinder"),
  process.env.NEO_KEYFINDER_ROOT
    ? path.resolve(process.env.NEO_KEYFINDER_ROOT, "src-tauri", "binaries")
    : undefined,
  path.resolve(appRoot, "../neo-keyfinder/src-tauri/binaries"),
  path.resolve(appRoot, "../neo-key-finder/neo-keyfinder/src-tauri/binaries"),
].filter(Boolean);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "muro-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow = null;
let backend = null;
let mediaShortcutRegistration = null;

const unregisterApplicationMediaShortcuts = () => {
  mediaShortcutRegistration?.unregister();
  mediaShortcutRegistration = null;
};

const registerApplicationMediaShortcuts = () => {
  if (mediaShortcutRegistration) return;
  mediaShortcutRegistration = registerMediaShortcuts({
    globalShortcut,
    onAction: (action) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      mainWindow.webContents.send("muro:event", "muro://media-control", {
        action,
        source: "global-shortcut",
      });
    },
  });
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    title: "Muro Music",
    icon: app.isPackaged ? undefined : developmentAppIcon,
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const createdWindow = mainWindow;
  createdWindow.on("closed", () => {
    if (mainWindow === createdWindow) mainWindow = null;
    unregisterApplicationMediaShortcuts();
  });

  const emitWindowState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("muro:event", "muro://window-maximized", {
        maximized: mainWindow.isMaximized(),
      });
    }
  };
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (process.env.MURO_DEV_URL) {
    await mainWindow.loadURL(process.env.MURO_DEV_URL);
  } else {
    await mainWindow.loadFile(path.join(appRoot, "dist", "index.html"));
  }
  registerApplicationMediaShortcuts();
};

const startApplication = async () => {
  if (!app.isPackaged && process.platform === "darwin") {
    app.dock?.setIcon(developmentAppIcon);
  }

  protocol.handle("muro-file", (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "local") {
        return new Response("Invalid file URL", { status: 400 });
      }
      const filePath = decodeURIComponent(url.pathname.slice(1));
      return createLocalFileResponse(request, filePath);
    } catch {
      return new Response("Invalid file URL", { status: 400 });
    }
  });

  const keyFinder = createKeyFinderService({
    binaryDirectories: app.isPackaged
      ? [path.join(process.resourcesPath, "keyfinder")]
      : developmentKeyFinderBinaries,
    emit: (sender, name, payload) => sender.send("muro:event", name, payload),
  });
  backend = createBackend({
    cacheDir: path.join(app.getPath("cache"), "covers"),
    artistProfileCacheDir: path.join(app.getPath("userData"), "artists"),
    emit: (sender, name, payload) => sender.send("muro:event", name, payload),
    keyFinder,
  });

  ipcMain.handle("muro:invoke", (event, command, args) =>
    backend.invoke(command, args ?? {}, event.sender)
  );
  ipcMain.handle("muro:app-data-dir", () => app.getPath("userData"));
  ipcMain.handle("muro:window-is-maximized", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window?.isMaximized() ?? false;
  });
  ipcMain.handle("muro:window-control", (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return false;

    switch (action) {
      case "minimize":
        window.minimize();
        return false;
      case "toggleMaximize":
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        return window.isMaximized();
      case "close":
        window.close();
        return false;
      default:
        throw new Error(`Unsupported window control action: ${String(action)}`);
    }
  });
  ipcMain.handle("muro:open-dialog", async (_event, options) => {
    const properties = [];
    if (options.directory) properties.push("openDirectory");
    else properties.push("openFile");
    if (options.multiple) properties.push("multiSelections");
    const result = await dialog.showOpenDialog(mainWindow, {
      properties,
      filters: Array.isArray(options.filters) ? options.filters : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return options.multiple ? result.filePaths : result.filePaths[0];
  });
  ipcMain.handle("muro:save-dialog", async (_event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: typeof options.title === "string" ? options.title : undefined,
      defaultPath: typeof options.defaultPath === "string" ? options.defaultPath : undefined,
      filters: Array.isArray(options.filters) ? options.filters : undefined,
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  });
  ipcMain.handle("muro:open-external", async (_event, value) => {
    const url = new URL(String(value));
    const allowedHost = url.hostname === "musicbrainz.org"
      || url.hostname.endsWith(".wikipedia.org")
      || url.hostname === "commons.wikimedia.org"
      || url.hostname === "www.last.fm"
      || url.hostname === "www.theaudiodb.com"
      || url.hostname === "fanart.tv"
      || url.hostname.endsWith(".fanart.tv");
    if (url.protocol !== "https:" || !allowedHost) throw new Error("External URL is not allowed");
    await shell.openExternal(url.toString());
  });
  ipcMain.handle("muro:confirm-dialog", async (_event, message, options) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: options.kind === "warning" ? "warning" : "question",
      title: typeof options.title === "string" ? options.title : "Muro Music",
      message,
      buttons: ["Cancel", "OK"],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  });
  ipcMain.on("muro:native-drag", (event, payload) => {
    event.sender.send("muro:event", "muro://native-drag", payload);
  });

  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch((error) => {
        console.error("Failed to recreate the application window:", error);
      });
    }
  });
};

app.whenReady().then(startApplication).catch((error) => {
  console.error("Failed to start Muro Music Electron:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => backend?.close());
app.on("will-quit", () => {
  unregisterApplicationMediaShortcuts();
});
