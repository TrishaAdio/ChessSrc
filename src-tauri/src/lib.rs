use serde::Serialize;
use tauri::{Manager, WebviewWindow};

/// Native material applied behind the transparent webview. The frontend reads
/// this to choose how opaque its ambient background should be.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Backdrop {
    /// Windows 11 (build 22000+) Mica.
    Mica,
    /// Windows 10 1809+ Acrylic. (Known to lag on Windows 10 while resizing.)
    Acrylic,
    /// Legacy DWM blur behind (older Windows 10 builds).
    Blur,
    /// No native material (macOS/Linux dev builds, or all effects failed).
    None,
}

struct BackdropState(Backdrop);

/// Tries the best material first and falls back. `window-vibrancy` returns
/// `Err` on unsupported OS builds, so the chain is safe.
fn apply_backdrop(window: &WebviewWindow) -> Backdrop {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_blur, apply_mica};

        // Deep sapphire tint matching the app's base palette (RGBA).
        const TINT: (u8, u8, u8, u8) = (8, 11, 24, 150);

        if apply_mica(window, Some(true)).is_ok() {
            return Backdrop::Mica;
        }
        if apply_acrylic(window, Some(TINT)).is_ok() {
            return Backdrop::Acrylic;
        }
        if apply_blur(window, Some(TINT)).is_ok() {
            return Backdrop::Blur;
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;

    Backdrop::None
}

#[tauri::command]
fn get_backdrop(state: tauri::State<'_, BackdropState>) -> Backdrop {
    state.0
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            // Restores size/position/maximized state. Visibility is skipped because
            // the frontend shows the window after its first paint (no white flash).
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");
            let backdrop = apply_backdrop(&window);
            app.manage(BackdropState(backdrop));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backdrop])
        .run(tauri::generate_context!())
        .expect("error while running CrystalChess");
}
