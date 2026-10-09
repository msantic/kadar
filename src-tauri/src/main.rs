//! The program's entry point. All of Kadar lives in the library (`lib.rs`); this file only starts it.

// Prevents an extra console window on Windows in release builds. Harmless on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kadar_lib::run()
}
