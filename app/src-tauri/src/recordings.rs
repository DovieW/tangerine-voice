use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// Simple on-disk store for WAV recordings keyed by request id.
///
/// Files are stored under `<app_data_dir>/recordings/<id>.wav`.
#[derive(Debug)]
pub struct RecordingStore {
    dir: PathBuf,
    // Keep a tiny in-memory cache of existence checks to avoid repeated fs hits.
    // This is best-effort; correctness still relies on the filesystem.
    known_existing: RwLock<std::collections::HashSet<String>>,
}

impl RecordingStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let dir = app_data_dir.join("recordings");
        let _ = fs::create_dir_all(&dir);
        Self {
            dir,
            known_existing: RwLock::new(std::collections::HashSet::new()),
        }
    }

    fn is_safe_request_id(id: &str) -> bool {
        // Request ids are expected to be UUID-like strings.
        // We keep this conservative to prevent path traversal / weird filenames.
        !id.trim().is_empty()
            && id
                .bytes()
                .all(|b| matches!(b, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_'))
    }

    fn path_for_id(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.wav", id))
    }

    /// Returns the absolute WAV path for a given request id if it exists on disk.
    ///
    /// This is intended for frontend playback via `convertFileSrc`.
    pub fn wav_path_if_exists(&self, id: &str) -> Result<Option<PathBuf>, String> {
        if !Self::is_safe_request_id(id) {
            return Err("Invalid request id".to_string());
        }

        if let Ok(known) = self.known_existing.read() {
            if known.contains(id) {
                let p = self.path_for_id(id);
                return Ok(if p.exists() { Some(p) } else { None });
            }
        }

        let path = self.path_for_id(id);
        if path.exists() {
            if let Ok(mut known) = self.known_existing.write() {
                known.insert(id.to_string());
            }
            Ok(Some(path))
        } else {
            Ok(None)
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn has(&self, id: &str) -> bool {
        if let Ok(known) = self.known_existing.read() {
            if known.contains(id) {
                return true;
            }
        }
        self.path_for_id(id).exists()
    }

    pub fn save_wav(&self, id: &str, wav_bytes: &[u8]) -> Result<(), String> {
        if id.trim().is_empty() {
            return Err("Cannot save recording: empty id".to_string());
        }
        if wav_bytes.is_empty() {
            return Err("Cannot save recording: empty audio".to_string());
        }

        let path = self.path_for_id(id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create recordings dir: {}", e))?;
        }

        fs::write(&path, wav_bytes).map_err(|e| format!("Failed to write recording {}: {}", path.display(), e))?;

        if let Ok(mut known) = self.known_existing.write() {
            known.insert(id.to_string());
        }

        Ok(())
    }

    pub fn load_wav(&self, id: &str) -> Result<Vec<u8>, String> {
        let path = self.path_for_id(id);
        fs::read(&path).map_err(|e| format!("Failed to read recording {}: {}", path.display(), e))
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn directory(&self) -> &Path {
        &self.dir
    }
}
