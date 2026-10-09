//! Dragging files out of Kadar, the way Finder does it, so every app accepts the drop:
//! - each file as its own item with a file URL, plus the old-style list of paths that some apps
//!   and browsers still read;
//! - Copy, Generic and Link allowed. Many apps answer a drop with "Generic"; a drag that allows
//!   only "Copy" then shows no drop area (seen with WhatsApp). Move is not allowed, so no app can
//!   take Kadar's files away.

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession, NSDraggingSource,
    NSEvent, NSEventModifierFlags, NSEventType, NSImage, NSPasteboardItem, NSPasteboardTypeFileURL,
    NSPasteboardWriting, NSWindow,
};
use objc2_foundation::{MainThreadMarker, NSArray, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString, NSURL};
use tauri::WebviewWindow;

/// Long side of the picture under the pointer while dragging.
const DRAG_IMAGE_SIZE: f64 = 120.0;

define_class!(
    // SAFETY: NSObject has no subclassing rules, and this class does not implement Drop.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "KadarDragSource"]
    struct DragSource;

    unsafe impl NSObjectProtocol for DragSource {}

    unsafe impl NSDraggingSource for DragSource {
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        fn operations(&self, _session: &NSDraggingSession, _context: NSDraggingContext) -> NSDragOperation {
            NSDragOperation::Copy | NSDragOperation::Generic | NSDragOperation::Link
        }
    }
);

impl DragSource {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

/// Starts a file drag at the pointer. Call while the mouse button is down (from a dragstart).
pub fn start(window: &WebviewWindow, paths: Vec<String>, icon: String) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
    window
        .run_on_main_thread(move || {
            // SAFETY: the window lives as long as the app; this runs on the main thread.
            let window = unsafe { &*(ns_window as *const NSWindow) };
            begin(window, &paths, &icon);
        })
        .map_err(|e| e.to_string())
}

fn begin(window: &NSWindow, paths: &[String], icon: &str) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let Some(view) = window.contentView() else { return };
    let at = window.mouseLocationOutsideOfEventStream();

    let image = NSImage::initByReferencingFile(NSImage::alloc(), &NSString::from_str(icon));
    if let Some(img) = &image {
        let s = img.size();
        if s.width > 0.0 && s.height > 0.0 {
            let k = DRAG_IMAGE_SIZE / s.width.max(s.height);
            img.setSize(NSSize::new(s.width * k, s.height * k));
        }
    }
    let size = image.as_ref().map_or(NSSize::new(DRAG_IMAGE_SIZE, DRAG_IMAGE_SIZE), |i| i.size());

    let all_paths: Vec<Retained<NSString>> = paths.iter().map(|p| NSString::from_str(p)).collect();
    let all_paths = NSArray::from_retained_slice(&all_paths);
    let legacy = NSString::from_str("NSFilenamesPboardType");

    let items: Vec<Retained<NSDraggingItem>> = paths
        .iter()
        .enumerate()
        .map(|(i, path)| {
            let item = NSPasteboardItem::new();
            let url = NSURL::fileURLWithPath(&NSString::from_str(path));
            if let Some(s) = url.absoluteString() {
                unsafe { item.setString_forType(&s, NSPasteboardTypeFileURL) };
            }
            if i == 0 {
                unsafe { item.setPropertyList_forType(&all_paths, &legacy) };
            }
            let writer: Retained<ProtocolObject<dyn NSPasteboardWriting>> = ProtocolObject::from_retained(item);
            let drag = NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), &writer);
            // Several files show as a small fanned stack.
            let offset = (i.min(4) as f64) * 6.0;
            let frame = NSRect::new(
                NSPoint::new(at.x - size.width / 2.0 + offset, at.y - size.height / 2.0 - offset),
                size,
            );
            let contents: Option<&AnyObject> = image.as_deref().map(|i| i.as_ref());
            unsafe { drag.setDraggingFrame_contents(frame, contents) };
            drag
        })
        .collect();

    let timestamp = NSApplication::sharedApplication(mtm).currentEvent().map_or(0.0, |e| e.timestamp());
    let Some(event) = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
        NSEventType::LeftMouseDragged,
        at,
        NSEventModifierFlags::empty(),
        timestamp,
        window.windowNumber(),
        None,
        0,
        1,
        1.0,
    ) else {
        return;
    };
    let source = DragSource::new(mtm);
    view.beginDraggingSessionWithItems_event_source(
        &NSArray::from_retained_slice(&items),
        &event,
        ProtocolObject::from_ref(&*source),
    );
}
