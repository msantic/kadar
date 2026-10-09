//! Screen recording with ScreenCaptureKit (macOS 15+): one window or the whole screen, with
//! system sound and a microphone. The Mac writes the capture to a file as it records; on stop,
//! the bundled video tool mixes the audio tracks, optionally levels them, and makes the MP4.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio, AVVideoCodecTypeHEVC};
use objc2_core_media::CMTime;
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, NSString, NSURL};
use objc2_screen_capture_kit::{
    SCCaptureResolutionType, SCContentFilter, SCRecordingOutput, SCRecordingOutputConfiguration,
    SCRecordingOutputDelegate, SCShareableContent, SCStream, SCStreamConfiguration, SCWindow,
};
use serde::{Deserialize, Serialize};

use tauri::Emitter;

use crate::video;

/// Value for `target` that records the main display instead of one app window.
pub const WHOLE_SCREEN: &str = "__screen__";
const FPS: i32 = 60;
const WAIT: Duration = Duration::from_secs(15);

/// Holds a value that crosses threads. ScreenCaptureKit objects are thread-safe; objc2 just
/// cannot know that.
struct Shared<T>(T);
unsafe impl<T> Send for Shared<T> {}

fn error_text(err: *mut NSError, fallback: &str) -> String {
    unsafe { err.as_ref() }
        .map(|e| e.localizedDescription().to_string())
        .unwrap_or_else(|| fallback.to_string())
}

// ─── Microphones ────────────────────────────────────────────────────────────

/// One microphone: the Mac's device id and its display name.
#[derive(Serialize)]
pub struct Microphone {
    id: String,
    name: String,
}

/// All audio input devices the Mac has (AVFoundation). Empty when there are none.
#[allow(deprecated)] // The discovery-session API needs a list of device kinds; this one does not.
pub fn microphones() -> Vec<Microphone> {
    let Some(audio) = (unsafe { AVMediaTypeAudio }) else { return Vec::new() };
    let devices = unsafe { AVCaptureDevice::devicesWithMediaType(audio) };
    devices
        .iter()
        .map(|d| unsafe { Microphone { id: d.uniqueID().to_string(), name: d.localizedName().to_string() } })
        .collect()
}

/// Microphone access: asks macOS once, then reports "granted" or "denied".
pub fn microphone_access() -> &'static str {
    let Some(audio) = (unsafe { AVMediaTypeAudio }) else { return "denied" };
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio) };
    if status == AVAuthorizationStatus::Authorized {
        return "granted";
    }
    if status != AVAuthorizationStatus::NotDetermined {
        return "denied";
    }
    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |ok: Bool| {
        let _ = tx.send(ok.as_bool());
    });
    unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &handler) };
    // The prompt waits for the user, so no timeout here would be wrong; 2 minutes is plenty.
    if rx.recv_timeout(Duration::from_secs(120)).unwrap_or(false) {
        "granted"
    } else {
        "denied"
    }
}

// ─── Recording delegate ─────────────────────────────────────────────────────

type Done = Result<(), String>;

/// For messages from the recording delegate to the window.
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Gives the recorder the app handle at launch, so a failure mid-recording can reach the window.
/// Only the first call counts.
pub fn set_app(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

define_class!(
    // SAFETY: NSObject has no subclassing rules, and this class does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "KadarRecordingDelegate"]
    #[ivars = Mutex<Option<Sender<Done>>>]
    struct RecordingDelegate;

    unsafe impl NSObjectProtocol for RecordingDelegate {}

    unsafe impl SCRecordingOutputDelegate for RecordingDelegate {
        #[unsafe(method(recordingOutput:didFailWithError:))]
        fn did_fail(&self, _output: &SCRecordingOutput, error: &NSError) {
            let message = error.localizedDescription().to_string();
            // Tell the window at once, not only at Stop, so it does not show a recording that is not.
            if let Some(app) = APP.get() {
                let _ = app.emit("record-failed", message.clone());
            }
            self.report(Err(message));
        }

        #[unsafe(method(recordingOutputDidFinishRecording:))]
        fn did_finish(&self, _output: &SCRecordingOutput) {
            self.report(Ok(()));
        }
    }
);

impl RecordingDelegate {
    fn new(tx: Sender<Done>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Mutex::new(Some(tx)));
        unsafe { msg_send![super(this), init] }
    }

    /// The first outcome wins; a failure after a finish (or the reverse) is ignored.
    fn report(&self, outcome: Done) {
        if let Some(tx) = crate::sync::lock(self.ivars()).take() {
            let _ = tx.send(outcome);
        }
    }
}

// ─── Recorder ───────────────────────────────────────────────────────────────

/// Recording settings from the window. No `mic_id` (or "") records no microphone.
/// `raw_output` makes a larger, higher-quality "-raw" file at a fixed 60 fps, for editing.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordOptions {
    /// An app name from the window list, or `WHOLE_SCREEN`.
    pub target: String,
    pub mic_id: Option<String>,
    pub system_audio: bool,
    pub output_dir: String,
    pub normalize_audio: bool,
    pub raw_output: bool,
}

struct Active {
    stream: Retained<SCStream>,
    _output: Retained<SCRecordingOutput>,
    _delegate: Retained<RecordingDelegate>,
    finished: Receiver<Done>,
    capture: PathBuf,
    final_base: PathBuf,
    opts: RecordOptions,
}

/// The running recording, if any. Only one recording runs at a time.
#[derive(Default)]
pub struct Recorder(Mutex<Option<Shared<Active>>>);

fn shareable_content() -> Result<Retained<SCShareableContent>, String> {
    let (tx, rx) = mpsc::channel::<Shared<Result<Retained<SCShareableContent>, String>>>();
    let handler = RcBlock::new(move |content: *mut SCShareableContent, err: *mut NSError| {
        let result = match unsafe { Retained::retain(content) } {
            Some(c) => Ok(c),
            None => Err(error_text(err, "Screen Recording is not allowed for Kadar.")),
        };
        let _ = tx.send(Shared(result));
    });
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&handler) };
    rx.recv_timeout(WAIT).map_err(|_| "macOS did not answer".to_string())?.0
}

/// Runs an SCStream start/stop call and waits for its completion handler.
fn wait_for(call: impl FnOnce(&block2::DynBlock<dyn Fn(*mut NSError)>)) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let handler = RcBlock::new(move |err: *mut NSError| {
        let _ = tx.send(if err.is_null() { Ok(()) } else { Err(error_text(err, "capture failed")) });
    });
    call(&handler);
    rx.recv_timeout(WAIT).map_err(|_| "macOS did not answer".to_string())?
}

fn even(v: f64) -> usize {
    ((v / 2.0).round() as usize * 2).max(2)
}

impl Recorder {
    /// Starts recording into `recording-<ms>-capture.mp4` in the output folder (made when
    /// missing). Waits up to 15 s for macOS. Error when a recording runs already, the window is
    /// not found, or Screen Recording is not allowed.
    pub fn start(&self, opts: RecordOptions) -> Result<(), String> {
        let mut slot = crate::sync::lock(&self.0);
        if slot.is_some() {
            return Err("A recording is already running.".into());
        }
        let content = shareable_content()?;
        let own_pid = std::process::id() as i32;

        let filter = unsafe {
            if opts.target == WHOLE_SCREEN {
                let display = content.displays().firstObject().ok_or("No display found.")?;
                // Leave Kadar's own window out of the recording.
                let own: Vec<Retained<SCWindow>> = content
                    .windows()
                    .iter()
                    .filter(|w| w.owningApplication().is_some_and(|a| a.processID() == own_pid))
                    .collect();
                let own = NSArray::from_retained_slice(&own);
                SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), &display, &own)
            } else {
                // The app's largest window, found by its window number: the picker's app names
                // come from the window list, and the recorder may name the app differently.
                let missing = || format!("No open window found for \"{}\".", opts.target);
                let id = crate::platform::capture::largest_window_id(&opts.target).ok_or_else(missing)?;
                let window = content.windows().iter().find(|w| w.windowID() == id).ok_or_else(missing)?;
                SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &window)
            }
        };

        // Full Retina resolution of what is recorded.
        let info = unsafe { SCShareableContent::infoForFilter(&filter) };
        let (rect, scale) = unsafe { (info.contentRect(), info.pointPixelScale() as f64) };
        let config = unsafe { SCStreamConfiguration::new() };
        unsafe {
            config.setWidth(even(rect.size.width * scale));
            config.setHeight(even(rect.size.height * scale));
            config.setMinimumFrameInterval(CMTime::new(1, FPS));
            config.setShowsCursor(true);
            config.setCaptureResolution(SCCaptureResolutionType::Best);
            config.setCapturesAudio(opts.system_audio);
            config.setExcludesCurrentProcessAudio(true);
            config.setSampleRate(48_000);
            config.setChannelCount(2);
            if let Some(mic) = opts.mic_id.as_deref().filter(|m| !m.is_empty()) {
                config.setCaptureMicrophone(true);
                config.setMicrophoneCaptureDeviceID(Some(&NSString::from_str(mic)));
            }
        }

        let dir = crate::platform::capture::expand_home(&opts.output_dir);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let final_base = dir.join(format!("recording-{stamp}"));
        let capture = dir.join(format!("recording-{stamp}-capture.mp4"));

        let (tx, finished) = mpsc::channel();
        let delegate = RecordingDelegate::new(tx);
        let output = unsafe {
            let out_config = SCRecordingOutputConfiguration::new();
            // HEVC, not the default H.264: H.264 stops at about 4K, so a full 5K screen (or a wide
            // window on it) failed at the first frame. The final MP4 is made from this file anyway.
            if let Some(hevc) = AVVideoCodecTypeHEVC {
                out_config.setVideoCodecType(hevc);
            }
            out_config.setOutputURL(&NSURL::fileURLWithPath(&NSString::from_str(&capture.to_string_lossy())));
            SCRecordingOutput::initWithConfiguration_delegate(
                SCRecordingOutput::alloc(),
                &out_config,
                ProtocolObject::from_ref(&*delegate),
            )
        };
        let stream = unsafe {
            SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), &filter, &config, None)
        };
        unsafe { stream.addRecordingOutput_error(&output) }.map_err(|e| e.localizedDescription().to_string())?;
        wait_for(|h| unsafe { stream.startCaptureWithCompletionHandler(Some(h)) })?;

        *slot = Some(Shared(Active { stream, _output: output, _delegate: delegate, finished, capture, final_base, opts }));
        Ok(())
    }

    /// Stops the capture, then makes the final MP4. Returns its path.
    pub fn stop(&self, progress: &dyn Fn(u32)) -> Result<String, String> {
        let Shared(active) = crate::sync::lock(&self.0).take().ok_or("No recording is running.")?;
        wait_for(|h| unsafe { active.stream.stopCaptureWithCompletionHandler(Some(h)) })?;
        active.finished.recv_timeout(WAIT).map_err(|_| "The recording did not finish.".to_string())??;
        finish(&active.capture, &active.final_base, &active.opts, progress)
    }
}

/// Capture file → final MP4. System sound and microphone arrive as separate tracks; they are
/// mixed into one, so every player and editor hears both.
fn finish(capture: &Path, base: &Path, opts: &RecordOptions, progress: &dyn Fn(u32)) -> Result<String, String> {
    let (crf, preset, audio_rate, suffix) = if opts.raw_output {
        ("12", "slow", "320k", "-raw")
    } else {
        ("18", "medium", "192k", "")
    };
    let dest = PathBuf::from(format!("{}{suffix}.mp4", base.to_string_lossy()));
    let tracks = video::audio_track_count(capture);

    let args = |level_audio: bool| -> Vec<String> {
        // Loudness leveling works at 192 kHz internally; bring it back to 48 kHz for AAC.
        let level = "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000";
        let mut args: Vec<String> = ["-c:v", "libx264", "-crf", crf, "-preset", preset, "-pix_fmt", "yuv420p"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        // The Mac sends frames only when the picture changes. Editors want a fixed frame rate.
        if opts.raw_output {
            args.extend(["-fps_mode", "cfr", "-r", "60"].map(String::from));
        }
        match tracks {
            0 => args.extend(["-map", "0:v:0", "-an"].map(String::from)),
            1 => {
                args.extend(["-map", "0:v:0", "-map", "0:a:0"].map(String::from));
                if level_audio {
                    args.extend(["-af".into(), level.into()]);
                }
            }
            _ => {
                let mut mix = "[0:a:0][0:a:1]amix=inputs=2:duration=longest:normalize=0".to_string();
                if level_audio {
                    mix = format!("{mix},{level}");
                }
                args.extend(["-filter_complex".into(), format!("{mix}[a]"), "-map".into(), "0:v:0".into(), "-map".into(), "[a]".into()]);
            }
        }
        args.extend(["-c:a", "aac", "-b:a", audio_rate, "-movflags", "+faststart"].map(String::from));
        args
    };
    let run = |level_audio: bool| -> Result<(), String> {
        let a = args(level_audio);
        let refs: Vec<&std::ffi::OsStr> = a.iter().map(std::ffi::OsStr::new).collect();
        video::encode(capture, &dest, &refs, progress)
    };

    // Leveling a silent track (system sound on, nothing playing) breaks the AAC encoder.
    // Silence needs no leveling: then make the file again without it.
    let leveled = opts.normalize_audio && tracks > 0;
    if let Err(first) = run(leveled) {
        if !leveled {
            return Err(first);
        }
        run(false)?;
    }
    let _ = std::fs::remove_file(capture);
    Ok(dest.to_string_lossy().into_owned())
}

