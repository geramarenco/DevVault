//! Google Drive backup: OAuth 2.0 (PKCE + loopback) and Drive v3 calls.
//! Only encrypted `.dvault` content ever leaves the machine. Scope `drive.file`
//! limits access to files this app created. The refresh token lives in the OS
//! credential store (Windows Credential Manager), never on disk.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const API: &str = "https://www.googleapis.com/drive/v3";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const FOLDER: &str = "DevVault Backups";
const KEYRING_SERVICE: &str = "DevVault";
const KEY_TOKEN: &str = "gdrive-refresh-token";
const KEY_ACCOUNT: &str = "gdrive-account";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);

/// `login_gen` identifies the current sign-in attempt; bumping it (cancel or a new attempt) ends any pending wait.
#[derive(Default)]
pub struct DriveState { access: Mutex<Option<(String, Instant)>>, login_gen: Arc<AtomicU64> }

#[derive(Serialize)]
pub struct DriveStatus { configured: bool, connected: bool, account: Option<String> }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile { id: String, name: String, #[serde(default)] size: Option<String>, #[serde(default)] created_time: Option<String> }

#[derive(Deserialize)]
struct TokenResponse { access_token: String, expires_in: u64, refresh_token: Option<String> }

#[derive(Deserialize)]
struct FileList { files: Vec<BackupFile> }

fn client_id() -> Result<String, String> {
  option_env!("DEVVAULT_GDRIVE_CLIENT_ID").map(String::from).or_else(|| std::env::var("DEVVAULT_GDRIVE_CLIENT_ID").ok()).filter(|s| !s.is_empty()).ok_or_else(|| "Google Drive no está configurado en esta compilación".to_string())
}
// Desktop OAuth clients get a "secret" Google itself documents as non-confidential; PKCE is the real protection.
fn client_secret() -> String {
  option_env!("DEVVAULT_GDRIVE_CLIENT_SECRET").map(String::from).or_else(|| std::env::var("DEVVAULT_GDRIVE_CLIENT_SECRET").ok()).unwrap_or_default()
}

fn entry(key: &str) -> Result<keyring::Entry, String> { keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string()) }
fn stored(key: &str) -> Option<String> { entry(key).ok()?.get_password().ok() }
fn random_b64(len: usize) -> String { let mut b = vec![0u8; len]; OsRng.fill_bytes(&mut b); URL_SAFE_NO_PAD.encode(b) }
fn http() -> reqwest::Client { reqwest::Client::builder().timeout(Duration::from_secs(60)).build().expect("cliente HTTP") }
fn q(s: &str) -> String { s.replace('\\', "\\\\").replace('\'', "\\'") }

async fn check(res: reqwest::Response) -> Result<reqwest::Response, String> {
  if res.status().is_success() { return Ok(res); }
  let status = res.status();
  let body = res.text().await.unwrap_or_default();
  Err(format!("Google Drive respondió {status}: {}", body.chars().take(300).collect::<String>()))
}

async fn access_token(state: &DriveState) -> Result<String, String> {
  if let Some((token, exp)) = state.access.lock().unwrap().clone() { if Instant::now() < exp { return Ok(token); } }
  let refresh = stored(KEY_TOKEN).ok_or("Google Drive no está conectado")?;
  let res = http().post(TOKEN_URL).form(&[("client_id", client_id()?), ("client_secret", client_secret()), ("refresh_token", refresh), ("grant_type", "refresh_token".into())]).send().await.map_err(|e| e.to_string())?;
  let tok: TokenResponse = check(res).await.map_err(|_| "La sesión de Google Drive caducó. Vuelve a conectar la cuenta.".to_string())?.json().await.map_err(|e| e.to_string())?;
  *state.access.lock().unwrap() = Some((tok.access_token.clone(), Instant::now() + Duration::from_secs(tok.expires_in.saturating_sub(60))));
  Ok(tok.access_token)
}

/// Browser page shown after the OAuth redirect; mirrors the app's gate card.
fn callback_page(ok: bool) -> String {
  let (state, icon, title, text) = if ok {
    ("ok", r#"<path d="M5 12.5l4.5 4.5L19 7.5"/>"#, "Google Drive conectado", "DevVault ya puede sincronizar tu bóveda. Puedes cerrar esta pestaña y volver a la aplicación.")
  } else {
    ("bad", r#"<path d="M7 7l10 10M17 7L7 17"/>"#, "No se pudo conectar", "La autorización no se completó. Vuelve a DevVault e inténtalo de nuevo.")
  };
  const PAGE: &str = r#"<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DevVault · Google Drive</title>
<style>
*{box-sizing:border-box}html{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font:14px "Segoe UI",system-ui,sans-serif;color:#e9f0ec;background:radial-gradient(circle at 50% 30%,#263b2d,#101714 55%) #101714}
main{width:420px;max-width:100%;padding:32px;background:#17211c;border:1px solid #35473e;border-radius:16px;box-shadow:0 18px 48px #0006;animation:in .4s cubic-bezier(.16,1,.3,1)}
header{display:flex;align-items:center;gap:14px;padding-bottom:24px;margin-bottom:24px;border-bottom:1px solid #29382f}
.mark{display:grid;place-items:center;width:48px;height:48px;border-radius:9px;background:#77e1a8;color:#102016;font:500 16px Consolas,monospace;letter-spacing:-.06em}
header b{display:block;font-size:20px;letter-spacing:-.04em}header small{font:11px Consolas,monospace;color:#84978b;letter-spacing:.06em}
.status{display:grid;grid-template-columns:28px 1fr;gap:14px}
.dot{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#77e1a8;color:#122018}
.bad .dot{background:transparent;border:1px solid #f19a8e;color:#f19a8e}
.dot svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
h1{margin:4px 0 6px;font-size:16px;color:#eef9f1}p{margin:0;color:#a9b9af;line-height:1.55}
footer{margin-top:24px;font:11px Consolas,monospace;color:#5c7163}
@keyframes in{from{opacity:0;transform:translateY(8px)}}
@media(prefers-reduced-motion:reduce){main{animation:none}}
</style>
<main class="{state}"><header><div class="mark">DV</div><div><b>DevVault</b><small>GOOGLE DRIVE</small></div></header>
<div class="status"><span class="dot"><svg viewBox="0 0 24 24">{icon}</svg></span><div><h1>{title}</h1><p>{text}</p></div></div>
<footer>127.0.0.1 · conexión local</footer></main></html>"#;
  PAGE.replace("{state}", state).replace("{icon}", icon).replace("{title}", title).replace("{text}", text)
}

/// Blocks until Google redirects the browser to the loopback listener; returns the `code`.
fn wait_for_code(listener: TcpListener, expected_state: String, login_gen: Arc<AtomicU64>, my_gen: u64) -> Result<String, String> {
  listener.set_nonblocking(true).map_err(|e| e.to_string())?;
  let deadline = Instant::now() + LOGIN_TIMEOUT;
  loop {
    if login_gen.load(Ordering::SeqCst) != my_gen { return Err("Conexión cancelada".into()); }
    match listener.accept() {
      Ok((mut stream, _)) => {
        stream.set_nonblocking(false).ok();
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let path = request.split_whitespace().nth(1).unwrap_or("");
        let Some(query) = path.split_once('?').map(|(_, q)| q) else { let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"); continue; };
        let params: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();
        let get = |k: &str| params.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone());
        let ok = get("state").as_deref() == Some(expected_state.as_str()) && get("code").is_some();
        let body = callback_page(ok);
        let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
        if let Some(err) = get("error") { return Err(format!("Autorización cancelada ({err})")); }
        return if ok { Ok(get("code").unwrap()) } else { Err("Respuesta de autorización inválida".into()) };
      }
      Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
        if Instant::now() > deadline { return Err("Tiempo de espera agotado al conectar con Google".into()); }
        std::thread::sleep(Duration::from_millis(150));
      }
      Err(e) => return Err(e.to_string()),
    }
  }
}

#[tauri::command]
pub async fn gdrive_status() -> DriveStatus {
  let connected = stored(KEY_TOKEN).is_some();
  DriveStatus { configured: client_id().is_ok(), connected, account: if connected { stored(KEY_ACCOUNT) } else { None } }
}

#[tauri::command]
pub async fn gdrive_connect(app: tauri::AppHandle, state: State<'_, DriveState>) -> Result<DriveStatus, String> {
  let client_id = client_id()?;
  let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
  let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
  let verifier = random_b64(48);
  let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
  let csrf = random_b64(24);
  let url = reqwest::Url::parse_with_params(AUTH_URL, &[("client_id", client_id.as_str()), ("redirect_uri", &redirect), ("response_type", "code"), ("scope", SCOPE), ("access_type", "offline"), ("prompt", "consent"), ("code_challenge", &challenge), ("code_challenge_method", "S256"), ("state", &csrf)]).map_err(|e| e.to_string())?;
  app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())?;
  let my_gen = state.login_gen.fetch_add(1, Ordering::SeqCst) + 1;
  let login_gen = state.login_gen.clone();
  let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, csrf, login_gen, my_gen)).await.map_err(|e| e.to_string())??;
  let res = http().post(TOKEN_URL).form(&[("client_id", client_id), ("client_secret", client_secret()), ("code", code), ("code_verifier", verifier), ("redirect_uri", redirect), ("grant_type", "authorization_code".into())]).send().await.map_err(|e| e.to_string())?;
  let tok: TokenResponse = check(res).await?.json().await.map_err(|e| e.to_string())?;
  let refresh = tok.refresh_token.ok_or("Google no devolvió un token de actualización")?;
  entry(KEY_TOKEN)?.set_password(&refresh).map_err(|e| e.to_string())?;
  *state.access.lock().unwrap() = Some((tok.access_token.clone(), Instant::now() + Duration::from_secs(tok.expires_in.saturating_sub(60))));
  // drive.file still allows about.get, which tells us which account is linked.
  let about: serde_json::Value = check(http().get(format!("{API}/about?fields=user(emailAddress)")).bearer_auth(&tok.access_token).send().await.map_err(|e| e.to_string())?).await?.json().await.map_err(|e| e.to_string())?;
  let account = about["user"]["emailAddress"].as_str().map(String::from);
  if let Some(a) = &account { let _ = entry(KEY_ACCOUNT)?.set_password(a); }
  Ok(DriveStatus { configured: true, connected: true, account })
}

#[tauri::command]
pub fn gdrive_cancel_connect(state: State<'_, DriveState>) { state.login_gen.fetch_add(1, Ordering::SeqCst); }

#[tauri::command]
pub async fn gdrive_disconnect(state: State<'_, DriveState>) -> Result<(), String> {
  if let Some(token) = stored(KEY_TOKEN) { let _ = http().post(REVOKE_URL).form(&[("token", token)]).send().await; }
  *state.access.lock().unwrap() = None;
  for key in [KEY_TOKEN, KEY_ACCOUNT] { if let Ok(e) = entry(key) { let _ = e.delete_credential(); } }
  Ok(())
}

async fn folder_id(token: &str, create: bool) -> Result<Option<String>, String> {
  let query = format!("name='{}' and mimeType='application/vnd.google-apps.folder' and trashed=false", q(FOLDER));
  let list: FileList = check(http().get(format!("{API}/files")).bearer_auth(token).query(&[("q", query.as_str()), ("fields", "files(id,name)"), ("spaces", "drive")]).send().await.map_err(|e| e.to_string())?).await?.json().await.map_err(|e| e.to_string())?;
  if let Some(f) = list.files.into_iter().next() { return Ok(Some(f.id)); }
  if !create { return Ok(None); }
  let created: BackupFile = check(http().post(format!("{API}/files?fields=id,name")).bearer_auth(token).json(&serde_json::json!({ "name": FOLDER, "mimeType": "application/vnd.google-apps.folder" })).send().await.map_err(|e| e.to_string())?).await?.json().await.map_err(|e| e.to_string())?;
  Ok(Some(created.id))
}

async fn list_in(token: &str, folder: &str) -> Result<Vec<BackupFile>, String> {
  let query = format!("'{}' in parents and trashed=false and name contains '.dvault'", q(folder));
  let list: FileList = check(http().get(format!("{API}/files")).bearer_auth(token).query(&[("q", query.as_str()), ("orderBy", "name desc"), ("pageSize", "200"), ("fields", "files(id,name,size,createdTime)")]).send().await.map_err(|e| e.to_string())?).await?.json().await.map_err(|e| e.to_string())?;
  Ok(list.files)
}

#[tauri::command]
pub async fn gdrive_list_backups(state: State<'_, DriveState>) -> Result<Vec<BackupFile>, String> {
  let token = access_token(&state).await?;
  match folder_id(&token, false).await? { Some(folder) => list_in(&token, &folder).await, None => Ok(vec![]) }
}

/// Uploads `content` as `name` and moves backups beyond `keep` (newest first) to the Drive trash.
#[tauri::command]
pub async fn gdrive_upload_backup(state: State<'_, DriveState>, name: String, content: String, keep: u32) -> Result<BackupFile, String> {
  let valid = name.ends_with(".dvault") && name.len() < 120 && name.chars().all(|c| c.is_ascii_alphanumeric() || "_-.".contains(c));
  if !valid { return Err("Nombre de backup inválido".into()); }
  let token = access_token(&state).await?;
  let folder = folder_id(&token, true).await?.ok_or("No se pudo crear la carpeta en Drive")?;
  let boundary = format!("devvault-{}", random_b64(12));
  let meta = serde_json::json!({ "name": name, "parents": [folder], "mimeType": "application/octet-stream" });
  let body = format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n{content}\r\n--{boundary}--\r\n");
  let file: BackupFile = check(http().post(UPLOAD).bearer_auth(&token).header("Content-Type", format!("multipart/related; boundary={boundary}")).body(body).send().await.map_err(|e| e.to_string())?).await?.json().await.map_err(|e| e.to_string())?;
  let keep = keep.max(1) as usize;
  for old in list_in(&token, &folder).await?.into_iter().skip(keep) {
    let _ = http().patch(format!("{API}/files/{}", old.id)).bearer_auth(&token).json(&serde_json::json!({ "trashed": true })).send().await;
  }
  Ok(file)
}

#[tauri::command]
pub async fn gdrive_download_backup(state: State<'_, DriveState>, id: String) -> Result<String, String> {
  if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { return Err("Identificador inválido".into()); }
  let token = access_token(&state).await?;
  check(http().get(format!("{API}/files/{id}?alt=media")).bearer_auth(&token).send().await.map_err(|e| e.to_string())?).await?.text().await.map_err(|e| e.to_string())
}
