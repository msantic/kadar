//! Lock helpers that survive a panic elsewhere. A thread that panics while holding a lock marks
//! it "poisoned"; `lock().unwrap()` would then panic in every later caller, so one bad image could
//! stop all thumbnails until a restart. The data under these locks stays valid after such a panic
//! (queues, lists, caches), so Kadar takes the lock and carries on.

use std::sync::{Condvar, Mutex, MutexGuard};

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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

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
