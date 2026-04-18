// Hindra extra konsol-fönster från att dyka upp i Windows-release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    podklipp_lib::run()
}
