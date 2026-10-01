import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: "hiddenInset",
    webPreferences: { preload: join(here, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void win.loadFile(join(here, "../dist/index.html"));
};
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
