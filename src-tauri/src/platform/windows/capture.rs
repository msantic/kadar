//! Screenshot on Windows: not ready yet (Roadmap in README.md: Windows Graphics Capture). Every
//! call answers clearly, and the window hides the Screenshot tab (`FEATURES`).

use serde::{Deserialize, Serialize};

const NOT_YET: &str = "Screenshots are not available on Windows yet.";

/// Screen capture state for the window: "granted" or "denied".
#[derive(Serialize)]
pub struct Permissions {
    screen: &'static str,
}

/// Screenshot settings from the window; the same fields as on the Mac.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // read once Windows capture exists
pub struct ShotOptions {
    pub app_name: String,
    pub output_dir: String,
    pub format: String,
    pub shadow: bool,
    #[serde(default)]
    pub trim_px: u32,
    #[serde(default)]
    pub scale: u32,
}

/// No app list yet.
pub fn running_apps() -> Vec<String> {
    Vec::new()
}

/// Reports "denied" until capture exists, so nothing tries to use it.
pub fn permissions() -> Permissions {
    Permissions { screen: "denied" }
}

/// Not ready on Windows.
pub fn resize_window(_app: &str, _width: i32, _height: i32, _x: i32, _y: i32) -> Result<(), String> {
    Err(NOT_YET.into())
}

/// Not ready on Windows.
pub fn take(_opts: &ShotOptions) -> Result<String, String> {
    Err(NOT_YET.into())
}
