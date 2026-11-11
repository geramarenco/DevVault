// Oculta la consola en builds de release en Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() { devvault_lib::run(); }
