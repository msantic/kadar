//! Recording on Windows: not ready yet (Roadmap in README.md: Windows Graphics Capture with
//! loopback sound, encoded by the bundled ffmpeg). Every call answers clearly, and the window
//! hides the Record tab (`FEATURES`).

use serde::{Deserialize, Serialize};

const NOT_YET: &str = "Recording is not available on Windows yet.";

/// One microphone: the system's device id and its display name.
#[derive(Serialize)]
pub struct Microphone {
    id: String,
    name: String,
}

/// No microphones are listed yet.
pub fn microphones() -> Vec<Microphone> {
    Vec::new()
}

/// "denied" until recording exists.
pub fn microphone_access() -> &'static str {
    "denied"
}

/// Nothing to keep yet; the Mac keeps the app handle for messages during a recording.
pub fn set_app(_app: tauri::AppHandle) {}

/// Recording settings from the window; the same fields as on the Mac.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // read once Windows recording exists
pub struct RecordOptions {
    pub target: String,
    pub mic_id: Option<String>,
    pub system_audio: bool,
    pub output_dir: String,
    pub normalize_audio: bool,
    pub raw_output: bool,
}

/// The running recording: none on Windows yet.
#[derive(Default)]
pub struct Recorder {
    _none: (),
}

impl Recorder {
    /// Not ready on Windows.
    pub fn start(&self, _opts: RecordOptions) -> Result<(), String> {
        Err(NOT_YET.into())
    }

    /// Not ready on Windows.
    pub fn stop(&self, _progress: &dyn Fn(u32)) -> Result<String, String> {
        Err(NOT_YET.into())
    }
}
