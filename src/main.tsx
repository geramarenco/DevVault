import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Credential, Vault, VaultField } from "./types";
import { emptyVault } from "./types";
import { translate, type Language } from "./i18n";
import "./styles.css";

const uid = () => crypto.randomUUID();
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const blankCredential = (): Credential => ({ id: uid(), name: "", project: localStorage.getItem("devvault-last-project") ?? "", environment: localStorage.getItem("devvault-last-environment") ?? "Development", service: "", tags: [], fields: [], updatedAt: new Date().toISOString() });

function App() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem("devvault-language") as Language) || "es");
  const t = (text: string) => translate(language, text);
  const [vault, setVault] = useState<Vault | null>(null), [path, setPath] = useState<string | null>(null), [password, setPassword] = useState(""), [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<Credential | null>(null), [revealed, setRevealed] = useState<Set<string>>(new Set()), [notice, setNotice] = useState(""), [settingsOpen, setSettingsOpen] = useState(false), [project, setProject] = useState<string | null>(null), [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => { if (!notice) return; const id = window.setTimeout(() => setNotice(""), 4000); return () => window.clearTimeout(id); }, [notice]);
  // Master password kept only in memory while the vault is unlocked; cleared on lock.
  const masterKey = useRef<string>("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const confirmDialog = (message: string, opts: { title: string; okLabel: string; cancelLabel: string; kind?: string }) => new Promise<boolean>(resolve => setDialog({ message, ...opts, resolve: v => resolve(v !== null) }));
  const passwordDialog = (message: string, opts: { title: string; okLabel: string; cancelLabel: string; placeholder: string }) => new Promise<string | null>(resolve => setDialog({ message, ...opts, password: true, resolve }));
  const [vaultFile, setVaultFile] = useState<string | null>(() => localStorage.getItem("devvault-last-file")), [confirmPassword, setConfirmPassword] = useState(""), [busy, setBusy] = useState(false);
  const resetLock = () => { if (!vault) return; window.clearTimeout(timer.current); timer.current = window.setTimeout(lock, vault.settings.autoLockMinutes * 60_000); };
  useEffect(() => { const activity = () => resetLock(); window.addEventListener("pointerdown", activity); window.addEventListener("keydown", activity); return () => { window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity); window.clearTimeout(timer.current); }; });
  useEffect(() => { const hotkeys = (e: KeyboardEvent) => { if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); document.querySelector<HTMLInputElement>("#search")?.focus(); } if (e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); setEditing(blankCredential()); } if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); lock(); } if (e.key === "Escape") { setEditing(null); setSettingsOpen(false); } }; window.addEventListener("keydown", hotkeys); return () => window.removeEventListener("keydown", hotkeys); });
  const lock = () => { masterKey.current = ""; setVault(null); setPath(null); setPassword(""); setSelected(null); setProject(null); setQuery(""); setSettingsOpen(false); setEditing(null); setRevealed(new Set()); setNotice("Bóveda bloqueada."); };
  const vaultFilters = [{ name: "Bóveda DevVault", extensions: ["dvault"] }];
  const pickFile = async () => { setNotice(""); const p = isNew ? await save({ defaultPath: "vault.dvault", filters: vaultFilters }) : await open({ filters: vaultFilters, multiple: false }); if (typeof p !== "string") return; setVaultFile(p); window.setTimeout(() => document.getElementById("master-password")?.focus(), 0); };
  const switchMode = (create: boolean) => { setIsNew(create); setVaultFile(create ? null : localStorage.getItem("devvault-last-file")); setPassword(""); setConfirmPassword(""); setNotice(""); };
  const unlocked = (v: Vault, file: string) => { masterKey.current = password; localStorage.setItem("devvault-last-file", file); setVault(v); setPath(file); setPassword(""); setConfirmPassword(""); setIsNew(false); };
  const openVault = async () => { if (!vaultFile || !password) return; setBusy(true); try { const encrypted = await readTextFile(vaultFile); unlocked(JSON.parse(await invoke<string>("decrypt_vault", { encrypted, password })) as Vault, vaultFile); setNotice("Bóveda desbloqueada."); } catch { setNotice("No se pudo abrir: contraseña incorrecta o archivo inválido."); } finally { setBusy(false); } };
  const createVault = async () => { if (!vaultFile) return; if (password.length < 10) return setNotice("Usa una contraseña maestra de al menos 10 caracteres."); if (password !== confirmPassword) return setNotice("Las contraseñas no coinciden."); setBusy(true); try { const v = emptyVault(); await writeTextFile(vaultFile, await invoke<string>("encrypt_vault", { plaintext: JSON.stringify(v), password })); unlocked(v, vaultFile); setNotice("Bóveda creada y cifrada."); } catch { setNotice("No se pudo crear la bóveda en esa ubicación."); } finally { setBusy(false); } };
  const persist = async (next: Vault) => { if (!path || !masterKey.current) return setNotice("Cambios no guardados: la bóveda está bloqueada."); try { await writeTextFile(path, await invoke<string>("encrypt_vault", { plaintext: JSON.stringify(next), password: masterKey.current })); setVault(next); setNotice("Cambios guardados y cifrados."); } catch { setNotice("No se pudieron guardar los cambios."); } };
  const matches = useMemo(() => !vault ? [] : (() => { const terms = norm(query).split(/\s+/).filter(Boolean); return vault.credentials.filter(c => { const hay = norm([c.name,c.project,c.environment,c.service,...c.tags,...c.fields.flatMap(f=>[f.name,f.value])].join("\n")); return terms.every(term => hay.includes(term)); }); })(), [vault, query]);
  const active = vault?.credentials.find(c => c.id === selected) ?? (project ? matches.filter(c => c.project.trim() === project) : matches)[0];
  const copy = async (value: string, id?: string) => { await writeText(value); if (id) { setCopied(id); window.setTimeout(() => setCopied(c => c === id ? null : c), 1600); } setNotice("Campo copiado. Se limpiará en 30 segundos si no cambias el portapapeles."); window.setTimeout(() => invoke("clear_clipboard_if_matches", { value }).catch(() => {}), 30_000); };
  const saveCredential = () => { if (!editing || !vault) return; const item = { ...editing, updatedAt: new Date().toISOString() }; if (item.project.trim()) localStorage.setItem("devvault-last-project", item.project.trim()); if (item.environment.trim()) localStorage.setItem("devvault-last-environment", item.environment.trim()); persist({ ...vault, credentials: vault.credentials.some(c=>c.id===item.id) ? vault.credentials.map(c=>c.id===item.id ? item : c) : [...vault.credentials, item] }); setSelected(item.id); setEditing(null); };
  const remove = async () => { if (!active || !vault) return; if (!(await confirmDialog(`${t("¿Eliminar")} “${active.name}”? ${t("Esta acción no se puede deshacer.")}`, { title: t("Eliminar credencial"), kind: "warning", okLabel: t("Eliminar"), cancelLabel: t("Cancelar") }))) return; persist({ ...vault, credentials: vault.credentials.filter(c=>c.id!==active.id) }); setSelected(null); };
  const backup = async () => { if (!path) return; const target = await save({ defaultPath: "vault-backup.dvault", filters: [{ name: "Bóveda cifrada", extensions: ["dvault"] }] }); if (!target) return; await writeTextFile(target, await readTextFile(path)); setNotice("Backup cifrado exportado."); };
  const restore = async () => { const source = await open({ filters: [{ name: "Bóveda cifrada", extensions: ["dvault"] }], multiple: false }); if (typeof source !== "string" || !path) return; const secret = await passwordDialog(t("Introduce la contraseña del backup para validar su integridad:"), { title: t("Importar backup"), okLabel: t("Validar"), cancelLabel: t("Cancelar"), placeholder: t("Contraseña del backup") }); if (!secret) return; try { const content = await readTextFile(source); JSON.parse(await invoke<string>("decrypt_vault", { encrypted: content, password: secret })); if (!(await confirmDialog(t("El backup es válido. ¿Reemplazar la bóveda actual?"), { title: t("Importar backup"), kind: "warning", okLabel: t("Reemplazar"), cancelLabel: t("Cancelar") }))) return; await writeTextFile(path, content); masterKey.current = secret; setVault(JSON.parse(await invoke<string>("decrypt_vault", { encrypted: content, password: secret }))); setNotice("Backup restaurado correctamente."); } catch { setNotice("El backup no es válido o la contraseña es incorrecta."); } };
  const languagePicker = <select className="language" aria-label="Language" value={language} onChange={e=>{const next=e.target.value as Language; setLanguage(next); localStorage.setItem("devvault-language",next); document.documentElement.lang=next;}}><option value="es">Español</option><option value="en">English</option></select>;
  if (!vault) {
    const fileName = vaultFile?.split(/[\\/]/).pop() ?? "";
    const passwordOk = isNew ? password.length >= 10 && password === confirmPassword : password.length > 0;
    const ready = !!vaultFile && passwordOk;
    const hint = !isNew ? null : password.length < 10 ? { tone: "", text: "Mínimo 10 caracteres." } : !confirmPassword ? { tone: "", text: "Repítela para confirmar." } : password !== confirmPassword ? { tone: "bad", text: "Las contraseñas no coinciden." } : { tone: "good", text: "Las contraseñas coinciden." };
    const failed = notice.startsWith("No se") || notice.startsWith("Usa ") || notice.startsWith("Las contraseñas");
    return <main className="gate"><section>
      <header className="gate-head"><div className="mark">DV</div><div><h1>DevVault</h1><p>{t("Tu bóveda local para secretos de desarrollo.")}</p></div></header>
      <div className="mode" role="tablist" aria-label={t("Modo")}><button type="button" role="tab" aria-selected={!isNew} onClick={()=>switchMode(false)}>{t("Abrir bóveda")}</button><button type="button" role="tab" aria-selected={isNew} onClick={()=>switchMode(true)}>{t("Crear bóveda")}</button></div>
      <form onSubmit={e=>{e.preventDefault(); if (ready && !busy) (isNew ? createVault() : openVault());}}>
        <ol className="steps">
          <li className={vaultFile ? "done" : "current"}>
            <span className="step-n">{vaultFile ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg> : 1}</span>
            <div className="step-body">
              <strong>{isNew ? t("Elige dónde guardarla") : t("Elige el archivo de la bóveda")}</strong>
              <button type="button" className={"file-pick" + (vaultFile ? " chosen" : "")} onClick={pickFile}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><rect x="9" y="13" width="6" height="5" rx="1"/><path d="M10.5 13v-1.5a1.5 1.5 0 0 1 3 0V13"/></svg>
                <span>{vaultFile ? fileName : isNew ? t("Elegir ubicación…") : t("Seleccionar archivo .dvault…")}</span>
                {vaultFile && <em>{t("Cambiar")}</em>}
              </button>
              {vaultFile && <small className="path" title={vaultFile}>{vaultFile}</small>}
            </div>
          </li>
          <li className={!vaultFile ? "locked" : passwordOk ? "done" : "current"}>
            <span className="step-n">{vaultFile && passwordOk ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg> : 2}</span>
            <div className="step-body">
              <label htmlFor="master-password"><strong>{isNew ? t("Define la contraseña maestra") : t("Ingresa la contraseña maestra")}</strong></label>
              <input id="master-password" type="password" autoComplete={isNew ? "new-password" : "current-password"} disabled={!vaultFile} placeholder={vaultFile ? t("Contraseña maestra") : t("Primero elige el archivo")} value={password} onChange={e=>{setPassword(e.target.value); if (failed) setNotice("");}}/>
              {isNew && <input type="password" autoComplete="new-password" aria-label={t("Repite la contraseña")} disabled={!vaultFile} placeholder={t("Repite la contraseña")} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/>}
              {isNew && vaultFile && hint && <small className={"hint " + hint.tone}>{t(hint.text)}</small>}
            </div>
          </li>
        </ol>
        <button className="primary submit" type="submit" disabled={!ready || busy}>{busy ? t("Procesando…") : isNew ? t("Crear bóveda") : t("Desbloquear")}</button>
      </form>
      {isNew && <small className="warn">{t("Sin recuperación: guarda tu contraseña maestra en un lugar seguro.")}</small>}
      {notice && <output role="status" className={failed ? "error" : ""}>{t(notice)}</output>}
    </section></main>;
  }
  const projects = distinct(vault.credentials.map(c=>c.project));
  const projectCount = (p: string) => vault.credentials.filter(c=>c.project.trim()===p).length;
  const visible = project ? matches.filter(c=>c.project.trim()===project) : matches;
  const current = visible.find(c=>c.id===selected) ?? visible[0];
  const pick = (fn: () => void) => () => { setSettingsOpen(false); fn(); };
  return <main className="app">
    <aside>
      <div className="brand"><span className="mark">DV</span><div><span>DevVault</span><small title={path ?? ""}>{path?.split(/[\\/]/).pop()}</small></div></div>
      <button className="new" onClick={pick(()=>setEditing(blankCredential()))}><Icon d="M12 5v14M5 12h14"/><span>{t("Nueva credencial")}</span><kbd>Ctrl N</kbd></button>
      <nav aria-label={t("Colecciones")}>
        <button className={!project && !settingsOpen ? "nav-active" : ""} onClick={pick(()=>setProject(null))}><Icon d="M4 6h16M4 12h16M4 18h16"/><span>{t("Todas")}</span><b>{vault.credentials.length}</b></button>
        {projects.length > 0 && <h2>{t("Proyectos")}</h2>}
        {projects.map(p=><button key={p} className={project===p && !settingsOpen ? "nav-active" : ""} onClick={pick(()=>{setProject(p); setSelected(null);})}><Icon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><span>{p}</span><b>{projectCount(p)}</b></button>)}
      </nav>
      <footer>
        <button onClick={backup}><Icon d="M12 4v11M7 10l5 5 5-5M5 20h14"/><span>{t("Exportar backup")}</span></button>
        <button onClick={restore}><Icon d="M12 20V9M7 14l5-5 5 5M5 4h14"/><span>{t("Importar backup")}</span></button>
        <button className={settingsOpen ? "nav-active" : ""} onClick={()=>setSettingsOpen(true)}><Icon d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6"/><span>{t("Configuración")}</span></button>
        <button className="lock" onClick={lock}><Icon d="M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4"/><span>{t("Bloquear")}</span><kbd>Ctrl L</kbd></button>
      </footer>
    </aside>
    <section className="list">
      <header>
        <div className="search"><Icon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4"/><input id="search" placeholder={t("Buscar en toda la bóveda…")} value={query} onKeyDown={e=>{if(e.key==="Escape"&&query){e.stopPropagation();setQuery("");}}} onChange={e=>{setSettingsOpen(false);setQuery(e.target.value)}}/>{query ? <button className="clear" title={t("Limpiar filtro")} aria-label={t("Limpiar filtro")} onClick={()=>{setQuery("");document.querySelector<HTMLInputElement>("#search")?.focus();}}><Icon d="M6 6l12 12M18 6 6 18"/></button> : <kbd>Ctrl K</kbd>}</div>
        <p className="list-meta"><span>{project ?? t("Todas")}</span><span>{visible.length} {visible.length===1 ? t("credencial") : t("credenciales")}</span></p>
      </header>
      <div className="results">
        {visible.map(c=><button className={current?.id===c.id && !settingsOpen ? "selected" : ""} key={c.id} onClick={pick(()=>setSelected(c.id))}>
          <span className="row-top"><strong>{c.name || t("Sin nombre")}</strong><Env value={c.environment}/></span>
          <span className="row-sub">{[project ? null : (c.project || t("Sin proyecto")), c.service].filter(Boolean).join(" · ") || " "}</span>
          {c.tags.length > 0 && <span className="row-tags">{c.tags.map(tag=><i key={tag}>{tag}</i>)}</span>}
        </button>)}
        {!visible.length && (vault.credentials.length
          ? <div className="empty"><p>{t("Nada coincide con el filtro.")}</p><button className="ghost" onClick={()=>{setQuery("");setProject(null);}}>{t("Limpiar filtro")}</button></div>
          : <div className="empty"><p>{t("No hay credenciales todavía.")}</p></div>)}
      </div>
    </section>
    <section className="detail">{settingsOpen ? <section className="settings">
        <header><h2>{t("Configuración")}</h2></header>
        <article className="setting-row"><div><strong>{t("Idioma")}</strong><p>{t("Elige el idioma de la interfaz.")}</p></div>{languagePicker}</article>
        <article className="setting-row"><div><strong>{t("Bloqueo automático")}</strong><p>{t("Tras este tiempo sin actividad, la bóveda se bloquea.")}</p></div><select className="language" aria-label={t("Bloqueo automático")} value={vault.settings.autoLockMinutes} onChange={e=>persist({...vault, settings:{...vault.settings, autoLockMinutes:Number(e.target.value)}})}>{[1,5,10,15,30,60].map(m=><option key={m} value={m}>{m} min</option>)}</select></article>
        <article className="setting-row"><div><strong>{t("Archivo de la bóveda")}</strong><p className="mono" title={path ?? ""}>{path}</p></div></article>
        <ChangePassword language={language} onChange={async (current, next) => { if (!path || !vault || current !== masterKey.current) return false; const tmp = path + ".tmp"; await writeTextFile(tmp, await invoke<string>("encrypt_vault", { plaintext: JSON.stringify(vault), password: next })); await rename(tmp, path); masterKey.current = next; setNotice("Contraseña maestra actualizada."); return true; }}/>
      </section>
      : current ? <article className="sheet" key={current.id}>
        <header>
          <span className="monogram" aria-hidden="true">{initials(current.service || current.name)}</span>
          <div className="title">
            <h2>{current.name || t("Sin nombre")}</h2>
            <p>{[current.project, current.service].filter(Boolean).map((part,i)=><React.Fragment key={i}>{i>0&&<span className="sep">/</span>}<span>{part}</span></React.Fragment>)}<Env value={current.environment}/></p>
          </div>
          <div className="actions">
            <button className="ghost" onClick={()=>setEditing(current)}><Icon d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>{t("Editar")}</button>
            <button className="icon danger" title={t("Eliminar")} aria-label={t("Eliminar")} onClick={remove}><Icon d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></button>
          </div>
        </header>
        {current.tags.length > 0 && <div className="tags">{current.tags.map(tag=><span key={tag}>{tag}</span>)}</div>}
        <div className="fields">
          {current.fields.map(f=><Field key={f.id} field={f} shown={revealed.has(f.id)} copied={copied===f.id} onReveal={()=>setRevealed(s=>{const n=new Set(s); n.has(f.id)?n.delete(f.id):n.add(f.id); return n;})} onCopy={()=>copy(f.value, f.id)} language={language}/>)}
          {!current.fields.length && <div className="no-fields"><p>{t("Esta credencial aún no tiene campos.")}</p><button className="ghost" onClick={()=>setEditing(current)}>{t("+ Agregar campo")}</button></div>}
        </div>
        <footer className="stamp">{t("Actualizada")} {new Date(current.updatedAt).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" })}</footer>
      </article>
      : <div className="detail-empty">
          <span className="mark big">DV</span>
          <h2>{vault.credentials.length ? t("Selecciona una credencial") : t("Tu bóveda está lista")}</h2>
          <p>{vault.credentials.length ? t("Elige una de la lista para ver sus campos.") : t("Guarda tu primera API key, token o cadena de conexión. Todo se cifra en este equipo.")}</p>
          {!vault.credentials.length && <button className="primary" onClick={()=>setEditing(blankCredential())}><Icon d="M12 5v14M5 12h14"/>{t("Nueva credencial")}</button>}
          <dl className="shortcuts"><div><dt><kbd>Ctrl K</kbd></dt><dd>{t("Buscar")}</dd></div><div><dt><kbd>Ctrl N</kbd></dt><dd>{t("Nueva")}</dd></div><div><dt><kbd>Ctrl L</kbd></dt><dd>{t("Bloquear")}</dd></div></dl>
        </div>}
    </section>
    {dialog && <ConfirmDialog {...dialog} onClose={v=>{dialog.resolve(v); setDialog(null);}}/>}
    {editing && <Editor credential={editing} isNew={!vault.credentials.some(c=>c.id===editing.id)} projects={projects} environments={distinct(vault.credentials.map(c=>c.environment))} setCredential={setEditing} onSave={saveCredential} onClose={()=>setEditing(null)} language={language}/>}
    {notice && <output className={"toast" + (/^(No se|El backup no|Cambios no)/.test(notice) ? " bad" : "")} role="status">{t(notice)}</output>}
  </main>;
}
type DialogState = { title: string; message: string; okLabel: string; cancelLabel: string; kind?: string; password?: boolean; placeholder?: string; resolve: (value: string | null) => void };
function ConfirmDialog({ title, message, okLabel, cancelLabel, kind, password, placeholder, onClose: close }: Omit<DialogState, "resolve"> & { onClose: (value: string | null) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const onClose = (ok: boolean) => close(ok ? value : null);
  useEffect(() => { (password ? inputRef.current : cancelRef.current)?.focus(); }, []);
  const danger = kind === "warning";
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(false); }} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(false); } }}>
    <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg">
      <span className={"confirm-ico" + (danger ? " danger" : "")} aria-hidden="true">{danger ? <Icon d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/> : <Icon d="M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/>}</span>
      <h2 id="confirm-title">{title}</h2>
      <p id="confirm-msg">{message}</p>
      {password && <form id="confirm-form" onSubmit={e => { e.preventDefault(); if (value) onClose(true); }}><input ref={inputRef} type="password" autoComplete="off" aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => setValue(e.target.value)}/></form>}
      <footer>
        <button type="button" ref={cancelRef} className="ghost" onClick={() => onClose(false)}>{cancelLabel}</button>
        <button type={password ? "submit" : "button"} form={password ? "confirm-form" : undefined} disabled={password && !value} className={danger ? "btn-danger" : "primary"} onClick={password ? undefined : () => onClose(true)}>{okLabel}</button>
      </footer>
    </div>
  </div>;
}
function ChangePassword({ language, onChange }: { language: Language; onChange: (current: string, next: string) => Promise<boolean> }) {
  const t = (s: string) => translate(language, s);
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [confirm, setConfirm] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const hint = !next ? null : next.length < 10 ? { tone: "", text: "Mínimo 10 caracteres." } : !confirm ? { tone: "", text: "Repítela para confirmar." } : next !== confirm ? { tone: "bad", text: "Las contraseñas no coinciden." } : next === current ? { tone: "bad", text: "La nueva contraseña debe ser distinta de la actual." } : { tone: "good", text: "Las contraseñas coinciden." };
  const ready = !!current && hint?.tone === "good" && !busy;
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (!ready) return; setBusy(true); setError(""); try { if (await onChange(current, next)) { setCurrent(""); setNext(""); setConfirm(""); } else setError("La contraseña actual no es correcta."); } catch { setError("No se pudo guardar la bóveda con la nueva contraseña. El archivo original no se modificó."); } finally { setBusy(false); } };
  return <form className="setting-block" onSubmit={submit}>
    <div><strong>{t("Contraseña maestra")}</strong><p>{t("Vuelve a cifrar la bóveda con una contraseña nueva. Los backups exportados antes conservan la contraseña anterior.")}</p></div>
    <div className="pw-grid">
      <input type="password" autoComplete="current-password" aria-label={t("Contraseña actual")} placeholder={t("Contraseña actual")} value={current} onChange={e=>{setCurrent(e.target.value); setError("");}}/>
      <input type="password" autoComplete="new-password" aria-label={t("Nueva contraseña")} placeholder={t("Nueva contraseña")} value={next} onChange={e=>setNext(e.target.value)}/>
      <input type="password" autoComplete="new-password" aria-label={t("Repite la contraseña")} placeholder={t("Repite la contraseña")} value={confirm} onChange={e=>setConfirm(e.target.value)}/>
    </div>
    <div className="pw-foot">
      <small className={"hint " + (error ? "bad" : hint?.tone ?? "")} role="status">{error ? t(error) : hint ? t(hint.text) : " "}</small>
      <button className="primary" type="submit" disabled={!ready}>{busy ? t("Procesando…") : t("Cambiar contraseña")}</button>
    </div>
  </form>;
}
const Icon = ({ d }: { d: string }) => <svg className="ico" viewBox="0 0 24 24" aria-hidden="true"><path d={d}/></svg>;
const initials = (s: string) => (s.trim().split(/[\s._-]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("") || "·").toUpperCase();
const envTone = (e: string) => { const v = norm(e); return /prod|prd|live/.test(v) ? "prod" : /stag|qa|test|uat|pre/.test(v) ? "stage" : "dev"; };
const Env = ({ value }: { value: string }) => value.trim() ? <span className={"env " + envTone(value)}>{value}</span> : null;
function Field({field,shown,copied,onReveal,onCopy,language}:{field:VaultField;shown:boolean;copied:boolean;onReveal:()=>void;onCopy:()=>void;language:Language}) { const hidden=field.sensitive&&!shown, t=(s:string)=>translate(language,s); return <article className={"field" + (hidden ? " masked" : "")}><label>{field.name || t("Sin nombre")}{field.sensitive && <small>{t("Secreto")}</small>}</label><pre onDoubleClick={onCopy} title={t("Doble clic para copiar")}>{hidden ? "•".repeat(Math.min(Math.max(field.value.length, 8), 16)) : field.value}</pre><div>{field.sensitive&&<button className="icon" title={shown?t("Ocultar"):t("Ver")} aria-label={shown?t("Ocultar"):t("Ver")} aria-pressed={shown} onClick={onReveal}>{shown?<Icon d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>:<Icon d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>}</button>}<button className={"icon" + (copied ? " ok" : "")} title={copied?t("Copiado"):t("Copiar")} aria-label={copied?t("Copiado"):t("Copiar")} onClick={onCopy}>{copied?<Icon d="M5 12.5l4.5 4.5L19 7.5"/>:<Icon d="M9 9h12v12H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>}</button></div></article> }
const distinct = (values: string[]) => [...new Set(values.map(v=>v.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
function Editor({credential,isNew,projects,environments,setCredential,onSave,onClose,language}:{credential:Credential;isNew:boolean;projects:string[];environments:string[];setCredential:(c:Credential)=>void;onSave:()=>void;onClose:()=>void;language:Language}) {
  const t=(s:string)=>translate(language,s), set=(key:keyof Credential,value:any)=>setCredential({...credential,[key]:value});
  const field=(i:number,key:keyof VaultField,value:any)=>set("fields",credential.fields.map((f,n)=>n===i?{...f,[key]:value}:f));
  const move=(i:number,dir:number)=>{const next=[...credential.fields]; [next[i],next[i+dir]]=[next[i+dir],next[i]]; set("fields",next);};
  return <div className="overlay"><form className="editor" onSubmit={e=>{e.preventDefault();onSave()}}>
    <header><h2>{isNew ? t("Nueva credencial") : t("Editar credencial")}</h2><button type="button" onClick={onClose}>×</button></header>
    <div className="grid">
      <label>{t("Nombre")}<input required value={credential.name} onChange={e=>set("name",e.target.value)}/></label>
      <label>{t("Proyecto")}<input list="project-options" value={credential.project} onChange={e=>set("project",e.target.value)}/></label>
      <label>{t("Entorno")}<input list="environment-options" value={credential.environment} onChange={e=>set("environment",e.target.value)}/></label>
      <label title={t("Plataforma o sistema al que pertenece la credencial. Opcional.")}>{t("Servicio")} <small className="opt">{t("opcional")}</small><input placeholder={t("Ej: AWS, Stripe, PostgreSQL, GitHub")} value={credential.service} onChange={e=>set("service",e.target.value)}/></label>
    </div>
    <datalist id="project-options">{projects.map(project=><option key={project} value={project}/>)}</datalist>
    <datalist id="environment-options">{environments.map(env=><option key={env} value={env}/>)}</datalist>
    <label>{t("Etiquetas")}<TagInput tags={credential.tags} onChange={tags=>set("tags",tags)} placeholder={t("Escribe y presiona Enter o coma")}/></label>
    <h3>{t("Campos")}</h3>
    {credential.fields.map((f,i)=><div className="field-edit" key={f.id}>
      <input placeholder={t("Nombre")} value={f.name} onChange={e=>field(i,"name",e.target.value)}/>
      <label className="switch"><input type="checkbox" role="switch" checked={f.sensitive} onChange={e=>setCredential({...credential,fields:credential.fields.map((x,n)=>n===i?{...x,sensitive:e.target.checked,fieldType:e.target.checked?"secret":"multiline"}:x)})}/><span aria-hidden="true"/>{t("Secreto")}</label>
      <div className="row-actions">
        <button type="button" className="icon" title={t("Subir")} aria-label={t("Subir")} disabled={i===0} onClick={()=>move(i,-1)}>↑</button>
        <button type="button" className="icon" title={t("Bajar")} aria-label={t("Bajar")} disabled={i===credential.fields.length-1} onClick={()=>move(i,1)}>↓</button>
        <button type="button" onClick={()=>set("fields",credential.fields.filter((_,n)=>n!==i))}>{t("Quitar")}</button>
      </div>
      <textarea placeholder={t("Valor")} spellCheck={false} value={f.value} onChange={e=>field(i,"value",e.target.value)}/>
    </div>)}
    <button type="button" onClick={()=>set("fields",[...credential.fields,{id:uid(),name:"",fieldType:"secret",value:"",sensitive:true}])}>{t("+ Agregar campo")}</button><footer><button type="button" onClick={onClose}>{t("Cancelar")}</button><button className="primary" type="submit">{t("Guardar")}</button></footer>
  </form></div>
}
function TagInput({tags,onChange,placeholder}:{tags:string[];onChange:(t:string[])=>void;placeholder:string}) {
  const [draft,setDraft]=useState("");
  const add=(raw:string)=>{const parts=raw.split(",").map(x=>x.trim()).filter(Boolean); if(parts.length) onChange([...new Set([...tags,...parts])]); setDraft("");};
  return <div className="tag-input">{tags.map(tag=><span key={tag}>{tag}<button type="button" aria-label={"× "+tag} onClick={()=>onChange(tags.filter(x=>x!==tag))}>×</button></span>)}
    <input value={draft} placeholder={tags.length?"":placeholder} onChange={e=>{const v=e.target.value; if(v.includes(",")) add(v); else setDraft(v);}} onKeyDown={e=>{if(e.key==="Enter"&&draft.trim()){e.preventDefault();add(draft);} else if(e.key==="Backspace"&&!draft&&tags.length) onChange(tags.slice(0,-1));}} onBlur={()=>{if(draft.trim()) add(draft);}}/></div>;
}
createRoot(document.getElementById("root")!).render(<App />);
