use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use tauri_plugin_clipboard_manager::ClipboardExt;
use zeroize::Zeroize;

const FORMAT: u8 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize)]
struct EncryptedVault { version: u8, salt: String, nonce: String, ciphertext: String, memory_kib: u32, iterations: u32, parallelism: u32 }

fn derive(password: &str, salt: &[u8], memory_kib: u32, iterations: u32, parallelism: u32) -> Result<[u8; 32], String> {
  let params = Params::new(memory_kib, iterations, parallelism, Some(32)).map_err(|_| "Parámetros Argon2 inválidos".to_string())?;
  let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
  let mut key = [0u8; 32];
  argon.hash_password_into(password.as_bytes(), salt, &mut key).map_err(|_| "No se pudo derivar la clave".to_string())?;
  Ok(key)
}

#[tauri::command]
fn encrypt_vault(plaintext: String, password: String) -> Result<String, String> {
  let mut salt = [0u8; SALT_LEN]; let mut nonce = [0u8; NONCE_LEN]; OsRng.fill_bytes(&mut salt); OsRng.fill_bytes(&mut nonce);
  let (memory_kib, iterations, parallelism) = (65_536, 3, 1);
  let mut key = derive(&password, &salt, memory_kib, iterations, parallelism)?;
  let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Clave AES inválida".to_string())?;
  let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes()).map_err(|_| "No se pudo cifrar".to_string())?;
  key.zeroize();
  serde_json::to_string(&EncryptedVault { version: FORMAT, salt: STANDARD_NO_PAD.encode(salt), nonce: STANDARD_NO_PAD.encode(nonce), ciphertext: STANDARD_NO_PAD.encode(encrypted), memory_kib, iterations, parallelism }).map_err(|_| "No se pudo serializar la bóveda".to_string())
}

#[tauri::command]
fn decrypt_vault(encrypted: String, password: String) -> Result<String, String> {
  let payload: EncryptedVault = serde_json::from_str(&encrypted).map_err(|_| "Formato de bóveda inválido".to_string())?;
  if payload.version != FORMAT { return Err("Versión de bóveda no compatible".into()); }
  let salt = STANDARD_NO_PAD.decode(payload.salt).map_err(|_| "Salt inválido".to_string())?;
  let nonce = STANDARD_NO_PAD.decode(payload.nonce).map_err(|_| "Nonce inválido".to_string())?;
  if salt.len() != SALT_LEN || nonce.len() != NONCE_LEN { return Err("Metadatos criptográficos inválidos".into()); }
  let bytes = STANDARD_NO_PAD.decode(payload.ciphertext).map_err(|_| "Contenido inválido".to_string())?;
  let mut key = derive(&password, &salt, payload.memory_kib, payload.iterations, payload.parallelism)?;
  let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Clave AES inválida".to_string())?;
  let plain = cipher.decrypt(Nonce::from_slice(&nonce), bytes.as_ref()).map_err(|_| "Contraseña incorrecta o bóveda alterada".to_string())?;
  key.zeroize();
  String::from_utf8(plain).map_err(|_| "Contenido de bóveda inválido".to_string())
}

#[tauri::command]
fn clear_clipboard_if_matches(app: tauri::AppHandle, value: String) -> Result<(), String> {
  let clipboard = app.clipboard();
  if clipboard.read_text().ok().as_deref() == Some(value.as_str()) { clipboard.write_text("").map_err(|e| e.to_string())?; }
  Ok(())
}

pub fn run() {
  tauri::Builder::default().plugin(tauri_plugin_clipboard_manager::init()).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_fs::init()).plugin(tauri_plugin_opener::init()).invoke_handler(tauri::generate_handler![encrypt_vault, decrypt_vault, clear_clipboard_if_matches]).run(tauri::generate_context!()).expect("error al iniciar DevVault");
}
