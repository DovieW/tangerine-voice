//! Anthropic (Claude) LLM provider for text formatting.

use super::{LlmError, LlmProvider, DEFAULT_LLM_TIMEOUT};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL: &str = "claude-3-haiku-20240307";
const API_VERSION: &str = "2023-06-01";

/// Anthropic (Claude) LLM provider using the Messages API
pub struct AnthropicLlmProvider {
    client: Client,
    api_key: String,
    model: String,
    timeout: Option<Duration>,
}

impl AnthropicLlmProvider {
    /// Create a new Anthropic provider with the given API key
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model: DEFAULT_MODEL.to_string(),
            timeout: Some(DEFAULT_LLM_TIMEOUT),
        }
    }

    /// Create with a specific model
    pub fn with_model(api_key: String, model: String) -> Self {
        Self {
            client: Client::new(),
            api_key,
            model,
            timeout: Some(DEFAULT_LLM_TIMEOUT),
        }
    }

    /// Create with custom client and settings
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn with_client(client: Client, api_key: String, model: Option<String>) -> Self {
        Self {
            client,
            api_key,
            model: model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
            timeout: Some(DEFAULT_LLM_TIMEOUT),
        }
    }

    /// Set the request timeout
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Disable request timeouts entirely.
    ///
    /// This is primarily intended for the Settings UI "Test" actions.
    pub fn without_timeout(mut self) -> Self {
        self.timeout = None;
        self
    }
}

#[derive(Debug, Serialize)]
struct MessageContent {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: Vec<MessageContent>,
}

#[derive(Debug, Serialize)]
struct MessagesRequest {
    model: String,
    max_tokens: u32,
    system: String,
    messages: Vec<Message>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    content_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ErrorDetail {
    message: String,
}

#[async_trait]
impl LlmProvider for AnthropicLlmProvider {
    async fn complete(&self, system_prompt: &str, user_message: &str) -> Result<String, LlmError> {
        if self.api_key.is_empty() {
            return Err(LlmError::NoApiKey("anthropic".to_string()));
        }

        let request = MessagesRequest {
            model: self.model.clone(),
            max_tokens: 4096,
            system: system_prompt.to_string(),
            messages: vec![Message {
                role: "user".to_string(),
                content: vec![MessageContent {
                    content_type: "text".to_string(),
                    text: user_message.to_string(),
                }],
            }],
        };

        let mut req = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&request);
        if let Some(timeout) = self.timeout {
            req = req.timeout(timeout);
        }

        let response = req.send().await.map_err(|e| {
            if e.is_timeout() {
                if let Some(timeout) = self.timeout {
                    LlmError::Timeout(timeout)
                } else {
                    // If we didn't configure a timeout, treat this as a generic network error.
                    LlmError::Network(e)
                }
            } else {
                LlmError::Network(e)
            }
        })?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            // Try to parse as error response
            if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&error_text) {
                return Err(LlmError::Api(format!(
                    "Anthropic API error ({}): {}",
                    status, error_response.error.message
                )));
            }
            return Err(LlmError::Api(format!(
                "Anthropic API error ({}): {}",
                status, error_text
            )));
        }

        let messages_response: MessagesResponse = response.json().await.map_err(|e| {
            LlmError::InvalidResponse(format!("Failed to parse response: {}", e))
        })?;

        // Extract text from the first text content block
        messages_response
            .content
            .iter()
            .find(|block| block.content_type == "text")
            .and_then(|block| block.text.clone())
            .ok_or_else(|| LlmError::InvalidResponse("No text content in response".to_string()))
    }

    fn name(&self) -> &'static str {
        "anthropic"
    }

    fn model(&self) -> &str {
        &self.model
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_name() {
        let provider = AnthropicLlmProvider::new("test-key".to_string());
        assert_eq!(provider.name(), "anthropic");
    }

    #[test]
    fn test_default_model() {
        let provider = AnthropicLlmProvider::new("test-key".to_string());
        assert_eq!(provider.model(), DEFAULT_MODEL);
    }

    #[test]
    fn test_custom_model() {
        let provider = AnthropicLlmProvider::with_model(
            "test-key".to_string(),
            "claude-3-opus-20240229".to_string(),
        );
        assert_eq!(provider.model(), "claude-3-opus-20240229");
    }

    #[test]
    fn test_without_timeout_disables_timeout() {
        let provider = AnthropicLlmProvider::new("test-key".to_string()).without_timeout();
        assert!(provider.timeout.is_none());
    }
}
