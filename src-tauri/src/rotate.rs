//! Rotate Left and Rotate Right (⌘L, ⌘R) for photos on disk. A photo is turned by its EXIF
//! orientation tag, not by its pixels: the picture data stays exactly as it was (no quality loss),
//! and every app that shows photos reads the tag. Each system writes the tag in
//! `platform::image::rotate`; the turn rules for the tag are here.

use serde::Serialize;

/// The orientation tag (1–8) after turning the shown picture a quarter turn. The tag says how to
/// turn and mirror the stored pixels for showing; a turn adds to that, and a mirrored photo stays
/// mirrored. An unknown tag counts as 1 (upright).
pub fn turned(orientation: u32, clockwise: bool) -> u32 {
    // Clockwise order of the plain tags and of the mirrored ones.
    const PLAIN: [u32; 4] = [1, 6, 3, 8];
    const MIRRORED: [u32; 4] = [2, 7, 4, 5];
    let (cycle, at) = match (PLAIN.iter().position(|&o| o == orientation), MIRRORED.iter().position(|&o| o == orientation)) {
        (Some(i), _) => (PLAIN, i),
        (None, Some(i)) => (MIRRORED, i),
        _ => (PLAIN, 0),
    };
    cycle[if clockwise { (at + 1) % 4 } else { (at + 3) % 4 }]
}

/// What happened to one file: `error` is a message to show, or None when it turned.
#[derive(Serialize)]
pub struct Rotated {
    pub path: String,
    pub error: Option<String>,
}

/// Turns each file a quarter turn, one after the other. One file that fails does not stop the rest.
pub fn rotate_files(paths: &[String], clockwise: bool) -> Vec<Rotated> {
    paths
        .iter()
        .map(|p| Rotated {
            path: p.clone(),
            error: crate::platform::image::rotate(std::path::Path::new(p), clockwise).err(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::turned;

    #[test]
    fn four_turns_come_back_and_left_undoes_right() {
        for o in 1..=8 {
            let mut t = o;
            for _ in 0..4 {
                t = turned(t, true);
            }
            assert_eq!(t, o, "four right turns of tag {o}");
            assert_eq!(turned(turned(o, true), false), o, "left undoes right for tag {o}");
        }
    }

    #[test]
    fn plain_and_mirrored_photos_turn_in_their_own_cycle() {
        assert_eq!(turned(1, true), 6, "upright → turned right");
        assert_eq!(turned(1, false), 8, "upright → turned left");
        assert_eq!(turned(6, true), 3, "two right turns: upside down");
        assert_eq!(turned(2, true), 7, "a mirrored photo stays mirrored");
        assert_eq!(turned(0, true), 6, "an unknown tag counts as upright");
    }
}
