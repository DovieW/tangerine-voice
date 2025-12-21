use std::sync::atomic::AtomicBool;

#[derive(Default)]
pub struct AppState {
    /// Tracks if currently recording (for both toggle and hold modes)
    pub is_recording: AtomicBool,
    /// Tracks whether we toggled MediaPlayPause when recording started.
    /// Used to restore playback when recording ends.
    pub play_pause_toggled: AtomicBool,
    /// Tracks if PTT key is currently held down (for hold-to-record mode)
    pub ptt_key_held: AtomicBool,
    /// Tracks if paste-last key is currently held down
    pub paste_key_held: AtomicBool,
    /// Tracks if toggle key is currently held down (for debouncing - action happens on release)
    pub toggle_key_held: AtomicBool,
}
