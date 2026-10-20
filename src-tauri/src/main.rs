// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // `tether --mcp` is the stdio bridge that AI agents launch; it never opens a window.
  if std::env::args().any(|a| a == "--mcp") {
    tether_lib::run_mcp_bridge();
    return;
  }
  tether_lib::run();
}
