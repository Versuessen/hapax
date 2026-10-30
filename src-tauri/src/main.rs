// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    linux_webkit_workarounds();
    hapax_lib::run()
}

/// WebKitGTK on Wayland + the proprietary NVIDIA driver can render a blank or
/// flickering window with the DMA-BUF renderer. Fedora KDE users on NVIDIA hit
/// this regularly, so disable it *only* in that situation and only if the
/// user has not set the variable themselves.
#[cfg(target_os = "linux")]
fn linux_webkit_workarounds() {
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some()
        || std::env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false);
    let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
    if wayland && nvidia && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // Still single-threaded here, before Tauri/GTK start.
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}
