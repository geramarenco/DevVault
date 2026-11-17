import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Solo en desarrollo: `VITE_FAKE_UPDATE=9.9.9 npm run tauri dev` simula que hay una versión nueva.
const FAKE = import.meta.env.DEV ? (import.meta.env.VITE_FAKE_UPDATE as string | undefined) : undefined;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const fakeCheck = async () => { await wait(1500); return { version: FAKE!, download: () => wait(3000), install: async () => { await wait(1500); alert(`[FAKE] Aquí se instalaría v${FAKE} y la app se reiniciaría.`); } } as unknown as Update; };
const checkUpdate = () => FAKE ? fakeCheck() : check();

const AUTO_KEY = "devvault-auto-update";
const readAuto = () => { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch { return true; } };
export type UpdateState = "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "installing" | "error";

// Comprueba actualizaciones al arrancar y cada 6 h (si está activo). Con auto activo, descarga en segundo plano.
export function useUpdater() {
  const [auto, setAutoState] = useState(readAuto);
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<UpdateState>("idle");
  const busy = useRef(false);

  const download = async (u: Update) => { setState("downloading"); try { await u.download(); setState("ready"); } catch (e) { console.warn(e); setState("error"); } };
  const checkNow = async (andDownload: boolean) => {
    if (busy.current) return; busy.current = true; setState("checking");
    try {
      const u = await checkUpdate();
      if (!u) { setState("uptodate"); return; }
      setUpdate(u); setState("available");
      if (andDownload) await download(u);
    } catch (e) { console.warn("update check failed", e); setState("error"); }
    finally { busy.current = false; }
  };
  const install = async () => {
    if (!update) return;
    try { if (state !== "ready") { setState("downloading"); await update.download(); } setState("installing"); await update.install(); if (FAKE) setState("ready"); else await relaunch(); }
    catch (e) { console.warn(e); setState("error"); }
  };
  const setAuto = (v: boolean) => { setAutoState(v); try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch {} };

  useEffect(() => {
    if (!auto) return;
    if (!update) checkNow(true); else if (state === "available") download(update);
    const id = window.setInterval(() => { if (!update) checkNow(true); }, 6 * 3600_000);
    return () => window.clearInterval(id);
  }, [auto, update]);

  return { auto, setAuto, update, state, checkNow: () => checkNow(auto), install };
}
