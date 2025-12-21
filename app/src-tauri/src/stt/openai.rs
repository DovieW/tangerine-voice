//! OpenAI STT provider implementation.
//!
//! Supports two modes:
//! - Legacy Whisper API (whisper-1) - uses /v1/audio/transcriptions
//! - Audio chat models (e.g., gpt-4o-audio-preview) - uses /v1/responses with audio input

use super::{AudioFormat, SttError, SttProvider};
use async_trait::async_trait;
use reqwest::multipart;
use serde_json::json;
use std::time::Duration;

/// OpenAI STT provider for speech-to-text
pub struct OpenAiSttProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

impl OpenAiSttProvider {
    /// Create a new OpenAI STT provider
    ///
    /// # Arguments
    /// * `api_key` - OpenAI API key
    /// * `model` - Model to use:
    ///   - "gpt-4o-audio-preview" (default) - GPT-4o with audio input
    ///   - "gpt-4o-mini-audio-preview" - Smaller/faster GPT-4o audio
    ///   - "whisper-1" - Legacy Whisper API
    pub fn new(api_key: String, model: Option<String>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120)) // Longer timeout for GPT-4o
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            api_key,
            model: model.unwrap_or_else(|| "gpt-4o-audio-preview".to_string()),
        }
    }

    /// Create a new provider with a custom HTTP client
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn with_client(client: reqwest::Client, api_key: String, model: Option<String>) -> Self {
        Self {
            client,
            api_key,
            model: model.unwrap_or_else(|| "gpt-4o-audio-preview".to_string()),
        }
    }

    /// Check if this model should use /v1/audio/transcriptions.
    ///
    /// Per OpenAI docs, `whisper-1` and the `*-transcribe` models are used via the
    /// dedicated transcription endpoint.
    fn uses_transcriptions_endpoint(&self) -> bool {
        self.model == "whisper-1" || self.model.contains("transcribe")
    }

    /// Transcribe using the dedicated OpenAI transcription endpoint.
    async fn transcribe_audio_transcriptions(&self, audio: &[u8]) -> Result<String, SttError> {
        let part = multipart::Part::bytes(audio.to_vec())
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| SttError::Audio(format!("Failed to create multipart: {}", e)))?;

        let form = multipart::Form::new()
            .part("file", part)
            .text("model", self.model.clone());

        let response = self
            .client
            .post("https://api.openai.com/v1/audio/transcriptions")
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| if e.is_timeout() { SttError::Timeout } else { SttError::Network(e) })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(SttError::Api(format!(
                "OpenAI Whisper API error ({}): {}",
                status, error_text
            )));
        }

        let result: serde_json::Value = response.json().await?;
        let text = result["text"].as_str().unwrap_or("").to_string();

        Ok(text)
    }

    fn extract_responses_output_text(value: &serde_json::Value) -> Result<String, SttError> {
        if let Some(s) = value.get("output_text").and_then(|v| v.as_str()) {
            return Ok(s.to_string());
        }

        let output = value
            .get("output")
            .and_then(|v| v.as_array())
            .ok_or_else(|| SttError::Api("Responses API returned no 'output' array".to_string()))?;

        for item in output {
            if item.get("type").and_then(|t| t.as_str()) != Some("message") {
                continue;
            }

            let content = match item.get("content").and_then(|c| c.as_array()) {
                Some(c) => c,
                None => continue,
            };

            for part in content {
                match part.get("type").and_then(|t| t.as_str()) {
                    Some("refusal") => {
                        let refusal = part
                            .get("refusal")
                            .and_then(|r| r.as_str())
                            .unwrap_or("");
                        return Err(SttError::Api(format!("OpenAI refusal: {}", refusal)));
                    }
                    Some("output_text") => {
                        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                            return Ok(text.to_string());
                        }
                    }
                    _ => {}
                }
            }
        }

        Err(SttError::Api(
            "Responses API returned no output_text content".to_string(),
        ))
    }

    /// Transcribe using the Responses API with audio input.
    async fn transcribe_responses_audio(&self, audio: &[u8]) -> Result<String, SttError> {
        use base64::{engine::general_purpose::STANDARD, Engine};

        // Encode audio as base64
        let audio_base64 = STANDARD.encode(audio);

        let request_body = json!({
            "model": self.model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": audio_base64,
                                "format": "wav"
                            }
                        },
                        {
                            "type": "text",
                            "text": "Transcribe this audio. Output only the transcribed text, nothing else."
                        }
                    ]
                }
            ],
            "text": {
                "format": {"type": "text"}
            }
        });

        let response = self
            .client
            .post("https://api.openai.com/v1/responses")
            .bearer_auth(&self.api_key)
            .json(&request_body)
            .send()
            .await
            .map_err(|e| if e.is_timeout() { SttError::Timeout } else { SttError::Network(e) })?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(SttError::Api(format!(
                "OpenAI GPT-4o API error ({}): {}",
                status, error_text
            )));
        }

        let result: serde_json::Value = response.json().await?;
        Self::extract_responses_output_text(&result)
    }
}

#[async_trait]
impl SttProvider for OpenAiSttProvider {
    async fn transcribe(&self, audio: &[u8], _format: &AudioFormat) -> Result<String, SttError> {
        if self.uses_transcriptions_endpoint() {
            self.transcribe_audio_transcriptions(audio).await
        } else {
            self.transcribe_responses_audio(audio).await
        }
    }

    fn name(&self) -> &'static str {
        "openai"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_creation() {
        let provider = OpenAiSttProvider::new("test-key".to_string(), None);
        assert_eq!(provider.name(), "openai");
        assert_eq!(provider.model, "gpt-4o-audio-preview");
    }

    #[test]
    fn test_provider_with_custom_model() {
        let provider =
            OpenAiSttProvider::new("test-key".to_string(), Some("whisper-1".to_string()));
        assert_eq!(provider.model, "whisper-1");
    }

    #[test]
    fn test_is_chat_audio_model() {
        let provider = OpenAiSttProvider::new("test-key".to_string(), None);
        assert!(!provider.uses_transcriptions_endpoint());

        let provider = OpenAiSttProvider::new(
            "test-key".to_string(),
            Some("gpt-4o-mini-audio-preview".to_string()),
        );
        assert!(!provider.uses_transcriptions_endpoint());

        let provider =
            OpenAiSttProvider::new("test-key".to_string(), Some("gpt-audio".to_string()));
        assert!(!provider.uses_transcriptions_endpoint());

        let provider = OpenAiSttProvider::new(
            "test-key".to_string(),
            Some("gpt-audio-mini".to_string()),
        );
        assert!(!provider.uses_transcriptions_endpoint());

        let provider =
            OpenAiSttProvider::new("test-key".to_string(), Some("whisper-1".to_string()));
        assert!(provider.uses_transcriptions_endpoint());

        let provider = OpenAiSttProvider::new(
            "test-key".to_string(),
            Some("gpt-4o-transcribe".to_string()),
        );
        assert!(provider.uses_transcriptions_endpoint());
    }
}
