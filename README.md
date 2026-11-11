# DevVault

A portable Windows application that centralizes development credentials in an encrypted local vault.

## Features

- Create and open vaults protected by a master password.
- Organize credentials by project, environment, service, and tags.
- Add custom fields, hide secrets, and copy individual values.
- Search the entire vault and lock it manually or after inactivity.
- Export and import encrypted backups.

Data is encrypted with AES-256-GCM and the key is derived with Argon2id. The master password is never stored and cannot be recovered.

## Requirements

- Windows 10/11.
- Node.js 20 or later.
- Stable Rust via [rustup](https://rustup.rs/).
- Visual Studio Build Tools with the **Desktop development with C++** workload.
- WebView2 Runtime (normally included with Windows 10/11).

## Run locally

```powershell
npm install
npm run tauri dev
```

To create a distribution build:

```powershell
npm run tauri build
```

The installers and executable are generated in `src-tauri/target/release/bundle/` and `src-tauri/target/release/`.
