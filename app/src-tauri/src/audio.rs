use rodio::source::Source;
use rodio::OutputStreamBuilder;
use std::thread;
use std::time::Duration;

/// Types of sounds that can be played
#[derive(Debug, Clone, Copy)]
pub enum SoundType {
    RecordingStart,
    RecordingStop,
}

/// Play a sound effect (non-blocking)
pub fn play_sound(sound_type: SoundType) {
    // Spawn a thread to play sound without blocking
    thread::spawn(move || {
        if let Err(e) = play_sound_blocking(sound_type) {
            log::warn!("Failed to play sound: {}", e);
        }
    });
}

fn play_sound_blocking(
    sound_type: SoundType,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // rodio 0.21 uses OutputStreamBuilder instead of OutputStream::try_default()
    let stream = OutputStreamBuilder::open_default_stream()?;

    let duration_ms = match sound_type {
        SoundType::RecordingStart => 120, // Bright tambourine shake
        SoundType::RecordingStop => 180,  // Slightly longer, lower shake
    };

    let source = TambourineSound::new(sound_type)
        .take_duration(Duration::from_millis(duration_ms))
        .amplify(0.35);

    // rodio 0.21 uses mixer().add() instead of play_raw()
    stream.mixer().add(source);

    // Wait for the sound to finish playing
    thread::sleep(Duration::from_millis(duration_ms + 50));

    Ok(())
}

/// A tambourine-like sound source combining metallic jingles with noise
struct TambourineSound {
    sample_rate: u32,
    sample_index: u64,
    /// Linear feedback shift register for noise generation
    noise_state: u32,
    /// Frequencies for the metallic jingle harmonics
    jingle_frequencies: Vec<f32>,
    /// Whether this is a start or stop sound
    is_start_sound: bool,
}

impl TambourineSound {
    fn new(sound_type: SoundType) -> Self {
        let is_start_sound = matches!(sound_type, SoundType::RecordingStart);

        // Tambourine jingles have multiple metallic frequencies
        // Higher frequencies for start (brighter), lower for stop
        let jingle_frequencies = if is_start_sound {
            // Bright, ascending jingle frequencies
            vec![2200.0, 3100.0, 4400.0, 5500.0, 6800.0]
        } else {
            // Slightly lower, descending feel
            vec![1800.0, 2600.0, 3600.0, 4800.0, 5200.0]
        };

        Self {
            sample_rate: 44100,
            sample_index: 0,
            noise_state: 0xACE1u32, // Seed for noise generator
            jingle_frequencies,
            is_start_sound,
        }
    }

    /// Generate pseudo-random noise using LFSR
    fn next_noise(&mut self) -> f32 {
        // Linear feedback shift register for white noise
        let bit = (self.noise_state
            ^ (self.noise_state >> 2)
            ^ (self.noise_state >> 3)
            ^ (self.noise_state >> 5))
            & 1;
        self.noise_state = (self.noise_state >> 1) | (bit << 15);
        // Convert to -1.0 to 1.0 range
        (self.noise_state as f32 / 32768.0) - 1.0
    }

    /// Calculate envelope value (fast attack, medium decay)
    fn envelope(&self, time_seconds: f32, duration_seconds: f32) -> f32 {
        let attack_time = 0.005; // 5ms attack

        if time_seconds < attack_time {
            // Fast attack
            time_seconds / attack_time
        } else {
            // Exponential decay
            let decay_progress = (time_seconds - attack_time) / (duration_seconds - attack_time);
            (-decay_progress * 4.0).exp()
        }
    }
}

impl Iterator for TambourineSound {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let time = self.sample_index as f32 / self.sample_rate as f32;
        let duration = if self.is_start_sound { 0.12 } else { 0.18 };

        // Calculate envelope
        let env = self.envelope(time, duration);

        // Mix multiple jingle frequencies (metallic harmonics)
        let mut jingle_sum = 0.0f32;
        for (index, &freq) in self.jingle_frequencies.iter().enumerate() {
            // Add slight detuning for more realistic jingle sound
            let detune = 1.0 + (index as f32 * 0.002);
            let phase = 2.0 * std::f32::consts::PI * freq * detune * time;

            // Each harmonic has different amplitude (higher harmonics quieter)
            let harmonic_amp = 1.0 / (1.0 + index as f32 * 0.3);
            jingle_sum += phase.sin() * harmonic_amp;
        }

        // Normalize jingle sum
        jingle_sum /= self.jingle_frequencies.len() as f32;

        // Generate filtered noise (tambourine "shimmer")
        let noise = self.next_noise();

        // High-pass filtered noise mixed with jingles
        // More noise for start (shaker feel), more tone for stop
        let noise_mix = if self.is_start_sound { 0.5 } else { 0.35 };
        let jingle_mix = 1.0 - noise_mix;

        let sample = env * (jingle_sum * jingle_mix + noise * noise_mix);

        self.sample_index = self.sample_index.wrapping_add(1);
        Some(sample)
    }
}

impl Source for TambourineSound {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        1
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}
