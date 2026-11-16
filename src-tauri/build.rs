// Google Drive OAuth credentials are baked in at compile time.
// Priority: DEVVAULT_GDRIVE_CLIENT_ID / _SECRET env vars (CI secrets), then the
// git-ignored `gdrive-client.json` next to this file (the JSON downloaded from Google Cloud).
fn main() {
  println!("cargo:rerun-if-env-changed=DEVVAULT_GDRIVE_CLIENT_ID");
  println!("cargo:rerun-if-env-changed=DEVVAULT_GDRIVE_CLIENT_SECRET");
  println!("cargo:rerun-if-changed=gdrive-client.json");
  if std::env::var("DEVVAULT_GDRIVE_CLIENT_ID").map_or(true, |v| v.is_empty()) {
    if let Ok(raw) = std::fs::read_to_string("gdrive-client.json") {
      let json: serde_json::Value = serde_json::from_str(&raw).expect("gdrive-client.json no es JSON válido");
      let cfg = json.get("installed").unwrap_or(&json);
      if let Some(id) = cfg["client_id"].as_str() { println!("cargo:rustc-env=DEVVAULT_GDRIVE_CLIENT_ID={id}"); }
      if let Some(secret) = cfg["client_secret"].as_str() { println!("cargo:rustc-env=DEVVAULT_GDRIVE_CLIENT_SECRET={secret}"); }
    }
  }
  tauri_build::build()
}
