//! Lock helpers that survive a panic elsewhere. A thread that panics while holding a lock marks
//! it "poisoned"; `lock().unwrap()` would then panic in every later caller, so one bad image could
//! stop all thumbnails until a restart. The data under these locks stays valid after such a panic
//! (queues, lists, caches), so Kadar takes the lock and carries on.
//! Also: `after_quiet`, which runs work once after a burst of signals stops.

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

/// Takes the lock, even when an earlier panic poisoned it.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Waits on the condition variable and takes the lock back, even when it is poisoned.
pub fn wait<'a, T>(cv: &Condvar, guard: MutexGuard<'a, T>) -> MutexGuard<'a, T> {
    cv.wait(guard).unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Consumes the mutex and returns its data, even when it is poisoned.
pub fn into_inner<T>(m: Mutex<T>) -> T {
    m.into_inner().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Runs `action` once when `quiet` has passed after the last signal sent to the returned sender.
/// One thread serves all signals for as long as the sender lives; it ends when the sender drops.
pub fn after_quiet(quiet: Duration, action: impl Fn() + Send + 'static) -> Sender<()> {
    let (tx, rx) = mpsc::channel::<()>();
    thread::spawn(move || {
        while rx.recv().is_ok() {
            loop {
                match rx.recv_timeout(quiet) {
                    Ok(()) => continue,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            action();
        }
    });
    tx
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn a_burst_of_signals_runs_the_action_once_after_the_quiet_time() {
        let runs = Arc::new(AtomicUsize::new(0));
        let counted = runs.clone();
        let tx = super::after_quiet(Duration::from_millis(100), move || {
            counted.fetch_add(1, Ordering::SeqCst);
        });
        for _ in 0..20 {
            tx.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(runs.load(Ordering::SeqCst), 0, "not while signals keep coming");
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(runs.load(Ordering::SeqCst), 1);
        tx.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(runs.load(Ordering::SeqCst), 2, "a later burst runs it again");
    }

    #[test]
    fn a_panic_while_locked_does_not_block_later_users() {
        let m = Arc::new(Mutex::new(1));
        let m2 = m.clone();
        let _ = std::thread::spawn(move || {
            let _g = m2.lock().unwrap();
            panic!("boom");
        })
        .join();
        assert!(m.lock().is_err(), "the lock is poisoned now");
        *super::lock(&m) += 1;
        assert_eq!(*super::lock(&m), 2);
    }
}
