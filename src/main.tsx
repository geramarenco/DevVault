import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Credential, FieldType, Vault, VaultField } from "./types";
import { emptyVault } from "./types";
import { translate, type Language } from "./i18n";
import "./styles.css";

const uid = () => crypto.randomUUID();
const types: FieldType[] = ["text", "secret", "url", "email", "token", "multiline"];
const blankCredential = (): Credential => ({ id: uid(), name: "", project: localStorage.getItem("devvault-last-project") ?? "", environment: localStorage.getItem("devvault-last-environment") ?? "Development", service: "", tags: [], fields: [], updatedAt: new Date().toISOString() });

function App() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem("devvault-language") as Language) || "es");
  const t = (text: string) => translate(language, text);
  const [vault, setVault] = useState<Vault | null>(null), [path, setPath] = useState<string | null>(null), [password, setPassword] = useState(""), [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<Credential | null>(null), [revealed, setRevealed] = useState<Set<string>>(new Set()), [notice, setNotice] = useState(""), [settingsOpen, setSettingsOpen] = useState(false);
  const timer = useRef<number>();
  // Master password kept only in memory while the vault is unlocked; cleared on lock.
  const masterKey = useRef<string>("");
  const [vaultFile, setVaultFile] = useState<string | null>(() => localStorage.getItem("devvault-last-file")), [confirmPassword, setConfirmPassword] = useState(""), [busy, setBusy] = useState(false);
  const resetLock = () => { if (!vault) return; window.clearTimeout(timer.current); timer.current = window.setTimeout(lock, vault.settings.autoLockMinutes * 60_000); };
  useEffect(() => { const activity = () => resetLock(); window.addEventListener("pointerdown", activity); window.addEventListener("keydown", activity); return () => { window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity); window.clearTimeout(timer.current); }; });
  useEffect(() => { const hotkeys = (e: KeyboardEvent) => { if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); document.querySelector<HTMLInputElement>("#search")?.focus(); } if (e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); setEditing(blankCredential()); } if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); lock(); } if (e.key === "Escape") setEditing(null); }; window.addEventListener("keydown", hotkeys); return () => window.removeEventListener("keydown", hotkeys); });
  const lock = () => { masterKey.current = ""; setVault(null); setPath(null); setPassword(""); setSelected(null); setEditing(null); setRevealed(new Set()); setNotice("Bóveda bloqueada."); };
  const vaultFilters = [{ name: "Bóveda DevVault", extensions: ["dvault"] }];
  const pickFile = async () => { setNotice(""); const p = isNew ? await save({ defaultPath: "vault.dvault", filters: vaultFilters }) : await open({ filters: vaultFilters, multiple: false }); if (typeof p !== "string") return; setVaultFile(p); window.setTimeout(() => document.getElementById("master-password")?.focus(), 0); };
  const switchMode = (create: boolean) => { setIsNew(create); setVaultFile(create ? null : localStorage.getItem("devvault-last-file")); setPassword(""); setConfirmPassword(""); setNotice(""); };
  const unlocked = (v: Vault, file: string) => { masterKey.current = password; localStorage.setItem("devvault-last-file", file); setVault(v); setPath(file); setPassword(""); setConfirmPassword(""); setIsNew(false); };
  const openVault = async () => { if (!vaultFile || !password) return; setBusy(true); try { const encrypted = await readTextFile(vaultFile); unlocked(JSON.parse(await invoke<string>("decrypt_vault", { encrypted, password })) as Vault, vaultFile); setNotice("Bóveda desbloqueada."); } catch { setNotice("No se pudo abrir: contraseña incorrecta o archivo inválido."); } finally { setBusy(false); } };
  const createVault = async () => { if (!vaultFile) return; if (password.length < 10) return setNotice("Usa una contraseña maestra de al menos 10 caracteres."); if (password !== confirmPassword) return setNotice("Las contraseñas no coinciden."); setBusy(true); try { const v = emptyVault(); await writeTextFile(vaultFile, await invoke<string>("encrypt_vault", { plaintext: JSON.stringify(v), password })); unlocked(v, vaultFile); setNotice("Bóveda creada y cifrada."); } catch { setNotice("No se pudo crear la bóveda en esa ubicación."); } finally { setBusy(false); } };
  const persist = async (next: Vault) => { if (!path || !masterKey.current) return setNotice("Cambios no guardados: la bóveda está bloqueada."); try { await writeTextFile(path, await invoke<string>("encrypt_vault", { plaintext: JSON.stringify(next), password: masterKey.current })); setVault(next); setNotice("Cambios guardados y cifrados."); } catch { setNotice("No se pudieron guardar los cambios."); } };
  const matches = useMemo(() => !vault ? [] : vault.credentials.filter(c => [c.name,c.project,c.environment,c.service,...c.tags,...c.fields.flatMap(f=>[f.name,f.value])].join(" ").toLowerCase().includes(query.toLowerCase())), [vault, query]);
  const active = vault?.credentials.find(c => c.id === selected) ?? matches[0];
  const copy = async (value: string) => { await writeText(value); setNotice("Campo copiado. Se limpiará en 30 segundos si no cambias el portapapeles."); window.setTimeout(() => invoke("clear_clipboard_if_matches", { value }).catch(() => {}), 30_000); };
  const saveCredential = () => { if (!editing || !vault) return; const item = { ...editing, updatedAt: new Date().toISOString() }; if (item.project.trim()) localStorage.setItem("devvault-last-project", item.project.trim()); if (item.environment.trim()) localStorage.setItem("devvault-last-environment", item.environment.trim()); persist({ ...vault, credentials: vault.credentials.some(c=>c.id===item.id) ? vault.credentials.map(c=>c.id===item.id ? item : c) : [...vault.credentials, item] }); setSelected(item.id); setEditing(null); };
  const remove = async () => { if (!active || !vault) return; if (!(await ask(`${t("¿Eliminar")} “${active.name}”? ${t("Esta acción no se puede deshacer.")}`, { title: t("Eliminar credencial"), kind: "warning", okLabel: t("Eliminar"), cancelLabel: t("Cancelar") }))) return; persist({ ...vault, credentials: vault.credentials.filter(c=>c.id!==active.id) }); setSelected(null); };
  const backup = async () => { if (!path) return; const target = await save({ defaultPath: "vault-backup.dvault", filters: [{ name: "Bóveda cifrada", extensions: ["dvault"] }] }); if (!target) return; await writeTextFile(target, await readTextFile(path)); setNotice("Backup cifrado exportado."); };
  const restore = async () => { const source = await open({ filters: [{ name: "Bóveda cifrada", extensions: ["dvault"] }], multiple: false }); if (typeof source !== "string" || !path) return; const secret = prompt(t("Introduce la contraseña del backup para validar su integridad:")); if (!secret) return; try { const content = await readTextFile(source); JSON.parse(await invoke<string>("decrypt_vault", { encrypted: content, password: secret })); if (!(await ask(t("El backup es válido. ¿Reemplazar la bóveda actual?"), { title: t("Importar backup"), kind: "warning", okLabel: t("Reemplazar"), cancelLabel: t("Cancelar") }))) return; await writeTextFile(path, content); masterKey.current = secret; setVault(JSON.parse(await invoke<string>("decrypt_vault", { encrypted: content, password: secret }))); setNotice("Backup restaurado correctamente."); } catch { setNotice("El backup no es válido o la contraseña es incorrecta."); } };
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
  return <main className="app"><aside><div className="brand"><span className="mark">DV</span><span>DevVault</span></div><button className="new" onClick={()=>{setSettingsOpen(false);setEditing(blankCredential())}}>+ {t("Nueva")} <kbd>Ctrl N</kbd></button><nav><span>{t("COLECCIONES")}</span><button className="nav-active">{t("Todas")} <b>{vault.credentials.length}</b></button><span>{t("PROYECTOS")}</span>{[...new Set(vault.credentials.map(c=>c.project).filter(Boolean))].map(p=><button key={p} onClick={()=>{setSettingsOpen(false);setQuery(p)}}>{p}</button>)}</nav><footer><button onClick={backup}>{t("Exportar backup")}</button><button onClick={restore}>{t("Importar backup")}</button><button onClick={()=>setSettingsOpen(true)}>{t("Configuración")}</button><button onClick={lock}>{t("Bloquear")} <kbd>Ctrl L</kbd></button></footer></aside><section className="list"><header><input id="search" placeholder={t("Buscar en toda la bóveda…")} value={query} onChange={e=>{setSettingsOpen(false);setQuery(e.target.value)}}/><kbd>Ctrl K</kbd></header><div className="results">{matches.map(c=><button className={active?.id===c.id?"selected":""} key={c.id} onClick={()=>{setSettingsOpen(false);setSelected(c.id)}}><strong>{c.name}</strong><span>{c.project || t("Sin proyecto")} · {c.environment} · {c.service || t("Sin servicio")}</span><i>{c.tags.join(" · ")}</i></button>)}{!matches.length && <p className="empty">{t("No hay credenciales todavía.")}<br/>{t("Crea una para empezar.")}</p>}</div></section><section className="detail">{settingsOpen ? <section className="settings"><header><div><h2>{t("Configuración")}</h2><p>{t("General")}</p></div></header><article className="setting-row"><div><strong>{t("Idioma")}</strong><p>{t("Elige el idioma de la interfaz.")}</p></div>{languagePicker}</article></section> : active ? <><header><div><h2>{active.name}</h2><p>{active.project} <span>/</span> {active.environment} <span>/</span> {active.service}</p></div><div className="actions"><button className="icon" title={t("Editar")} aria-label={t("Editar")} onClick={()=>setEditing(active)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button className="icon danger" title={t("Eliminar")} aria-label={t("Eliminar")} onClick={remove}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button></div></header><div className="tags">{active.tags.map(t=><span key={t}>{t}</span>)}</div><div className="fields">{active.fields.map(f=><Field key={f.id} field={f} shown={revealed.has(f.id)} onReveal={()=>setRevealed(s=>{const n=new Set(s); n.has(f.id)?n.delete(f.id):n.add(f.id); return n;})} onCopy={copy} language={language}/>)}</div></> : <div className="empty detail-empty">{t("Selecciona una credencial")}</div>}</section>{editing && <Editor credential={editing} isNew={!vault.credentials.some(c=>c.id===editing.id)} projects={distinct(vault.credentials.map(c=>c.project))} environments={distinct(vault.credentials.map(c=>c.environment))} setCredential={setEditing} onSave={saveCredential} onClose={()=>setEditing(null)} language={language}/>}<output className="toast">{t(notice)}</output></main>;
}
function Field({field,shown,onReveal,onCopy,language}:{field:VaultField;shown:boolean;onReveal:()=>void;onCopy:(v:string)=>void;language:Language}) { const hidden=field.sensitive&&!shown, t=(s:string)=>translate(language,s); return <article className="field"><label>{field.name}<small>{field.fieldType}</small></label><pre>{hidden ? "••••••••••••••••" : field.value}</pre><div>{field.sensitive&&<button className="icon" title={shown?t("Ocultar"):t("Ver")} aria-label={shown?t("Ocultar"):t("Ver")} onClick={onReveal}><svg viewBox="0 0 24 24" aria-hidden="true">{shown?<><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>:<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>}</svg></button>}<button className="icon" title={t("Copiar")} aria-label={t("Copiar")} onClick={()=>onCopy(field.value)}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg></button></div></article> }
const distinct = (values: string[]) => [...new Set(values.map(v=>v.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
function Editor({credential,isNew,projects,environments,setCredential,onSave,onClose,language}:{credential:Credential;isNew:boolean;projects:string[];environments:string[];setCredential:(c:Credential)=>void;onSave:()=>void;onClose:()=>void;language:Language}) {
  const t=(s:string)=>translate(language,s), set=(key:keyof Credential,value:any)=>setCredential({...credential,[key]:value});
  const field=(i:number,key:keyof VaultField,value:any)=>set("fields",credential.fields.map((f,n)=>n===i?{...f,[key]:value}:f));
  return <div className="overlay"><form className="editor" onSubmit={e=>{e.preventDefault();onSave()}}>
    <header><h2>{isNew ? t("Nueva credencial") : t("Editar credencial")}</h2><button type="button" onClick={onClose}>×</button></header>
    <div className="grid">
      <label>{t("Nombre")}<input required value={credential.name} onChange={e=>set("name",e.target.value)}/></label>
      <label>{t("Proyecto")}<input list="project-options" value={credential.project} onChange={e=>set("project",e.target.value)}/></label>
      <label>{t("Entorno")}<input list="environment-options" value={credential.environment} onChange={e=>set("environment",e.target.value)}/></label>
      <label>{t("Servicio")}<input value={credential.service} onChange={e=>set("service",e.target.value)}/></label>
    </div>
    <datalist id="project-options">{projects.map(project=><option key={project} value={project}/>)}</datalist>
    <datalist id="environment-options">{environments.map(env=><option key={env} value={env}/>)}</datalist>
    <label>{t("Etiquetas")} <input value={credential.tags.join(", ")} onChange={e=>set("tags",e.target.value.split(",").map(x=>x.trim()).filter(Boolean))}/></label><h3>{t("Campos")}</h3>{credential.fields.map((f,i)=><div className="field-edit" key={f.id}><input placeholder={t("Nombre")} value={f.name} onChange={e=>field(i,"name",e.target.value)}/><select value={f.fieldType} onChange={e=>field(i,"fieldType",e.target.value)}>{types.map(t=><option key={t}>{t}</option>)}</select><label className="check"><input type="checkbox" checked={f.sensitive} onChange={e=>field(i,"sensitive",e.target.checked)}/> {t("Secreto")}</label><textarea placeholder={t("Valor")} value={f.value} onChange={e=>field(i,"value",e.target.value)}/><button type="button" onClick={()=>set("fields",credential.fields.filter((_,n)=>n!==i))}>{t("Quitar")}</button></div>)}<button type="button" onClick={()=>set("fields",[...credential.fields,{id:uid(),name:"",fieldType:"secret",value:"",sensitive:true}])}>{t("+ Agregar campo")}</button><footer><button type="button" onClick={onClose}>{t("Cancelar")}</button><button className="primary" type="submit">{t("Guardar")}</button></footer>
  </form></div>
}
createRoot(document.getElementById("root")!).render(<App />);
