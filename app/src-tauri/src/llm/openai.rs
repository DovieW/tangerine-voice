//! OpenAI LLM provider for text formatting.

use super::{LlmError, LlmProvider, DEFAULT_LLM_TIMEOUT};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL: &str = "gpt-4o-mini";

/// OpenAI LLM provider using the Chat Completions API
pub struct OpenAiLlmProvider {
    client: Client,
    api_key: String,
    model: String,
    timeout: Option<Duration>,
}

impl OpenAiLlmProvider {
    /// Create a new OpenAI provider with the given API key
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

    fn supports_structured_outputs(model: &str) -> bool {
        // GPT-4.1 family supports Structured Outputs; using it for rewrite makes outputs
        // deterministic and easier to parse.
        //
        // Docs: https://platform.openai.com/docs/guides/structured-outputs
        model.starts_with("gpt-4.1")
    }

    fn rewrite_response_format() -> TextFormat {
        // Keep the schema intentionally tiny: the app only needs the final rewritten text.
        // Rich field descriptions make the model's job (and prompt-writing) easier.
        // NOTE: For the Responses API, structured output is configured via `text.format`,
        // and `name/strict/schema` are top-level fields under `format`.
        // Docs: https://platform.openai.com/docs/guides/structured-outputs_api-mode=responses
        TextFormat {
            format_type: "json_schema".to_string(),
            name: Some("rewrite_response".to_string()),
            strict: Some(true),
            description: Some(
                "Structured output for a dictation transcript rewrite. The model must emit valid JSON matching the schema."
                    .to_string(),
            ),
            schema: Some(json!({
                "type": "object",
                "properties": {
                    "rewritten_text": {
                        "type": "string",
                        "description": "The final rewritten transcript text. This string will be used directly as the output. Preserve meaning, intent, and any required formatting. Do not wrap in markdown or add extra commentary. Return an empty string only if the input transcript is empty."
                    }
                },
                "required": ["rewritten_text"],
                "additionalProperties": false
            })),
        }
    }

    fn extract_responses_output_text(value: &serde_json::Value) -> Result<String, LlmError> {
        // Prefer the SDK-style convenience field when present.
        if let Some(s) = value.get("output_text").and_then(|v| v.as_str()) {
            return Ok(s.to_string());
        }

        let output = value
            .get("output")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                LlmError::InvalidResponse("Responses API returned no 'output' array".to_string())
            })?;

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
                        return Err(LlmError::Api(format!(
                            "OpenAI refusal: {}",
                            refusal
                        )));
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

        Err(LlmError::InvalidResponse(
            "Responses API returned no output_text content".to_string(),
        ))
    }
}

#[derive(Debug, Serialize)]
struct ResponsesRequest {
    model: String,
    input: Vec<ResponseInputMessage>,
    max_output_tokens: u32,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<TextConfig>,
}

#[derive(Debug, Serialize)]
struct ResponseInputMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct TextConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<TextFormat>,
}

#[derive(Debug, Serialize)]
struct TextFormat {
    #[serde(rename = "type")]
    format_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    strict: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    schema: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
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
impl LlmProvider for OpenAiLlmProvider {
    async fn complete(&self, system_prompt: &str, user_message: &str) -> Result<String, LlmError> {
        if self.api_key.is_empty() {
            return Err(LlmError::NoApiKey("openai".to_string()));
        }

        let use_structured_outputs = Self::supports_structured_outputs(&self.model);

        // When using Structured Outputs, a short explicit instruction helps avoid
        // accidental prose even though the schema is enforced server-side.
        let system_prompt = if use_structured_outputs {
            format!(
                "{}\n\nReturn ONLY valid JSON that matches the provided JSON Schema (no markdown, no extra keys).",
                system_prompt
            )
        } else {
            system_prompt.to_string()
        };

        let request = ResponsesRequest {
            model: self.model.clone(),
            input: vec![
                ResponseInputMessage {
                    role: "system".to_string(),
                    content: system_prompt,
                },
                ResponseInputMessage {
                    role: "user".to_string(),
                    content: user_message.to_string(),
                },
            ],
            max_output_tokens: 4096,
            temperature: 0.0, // Deterministic formatting/rewrite
            text: use_structured_outputs.then(|| TextConfig {
                format: Some(Self::rewrite_response_format()),
            }),
        };

        let mut req = self
            .client
            .post(OPENAI_API_URL)
            .bearer_auth(&self.api_key)
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
                    "OpenAI API error ({}): {}",
                    status, error_response.error.message
                )));
            }
            return Err(LlmError::Api(format!(
                "OpenAI API error ({}): {}",
                status, error_text
            )));
        }

        let response_json: serde_json::Value = response.json().await.map_err(|e| {
            LlmError::InvalidResponse(format!("Failed to parse response: {}", e))
        })?;

        let output_text = Self::extract_responses_output_text(&response_json)?;

        if use_structured_outputs {
            let v: serde_json::Value = serde_json::from_str(&output_text).map_err(|e| {
                LlmError::InvalidResponse(format!(
                    "Structured output was not valid JSON: {} (content: {})",
                    e, output_text
                ))
            })?;

            let rewritten = v
                .get("rewritten_text")
                .and_then(|t| t.as_str())
                .ok_or_else(|| {
                    LlmError::InvalidResponse(format!(
                        "Structured output missing required field 'rewritten_text' (content: {})",
                        output_text
                    ))
                })?;

            Ok(rewritten.to_string())
        } else {
            Ok(output_text)
        }
    }

    fn name(&self) -> &'static str {
        "openai"
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
        let provider = OpenAiLlmProvider::new("test-key".to_string());
        assert_eq!(provider.name(), "openai");
    }

    #[test]
    fn test_default_model() {
        let provider = OpenAiLlmProvider::new("test-key".to_string());
        assert_eq!(provider.model(), DEFAULT_MODEL);
    }

    #[test]
    fn test_custom_model() {
        let provider = OpenAiLlmProvider::with_model("test-key".to_string(), "gpt-4".to_string());
        assert_eq!(provider.model(), "gpt-4");
    }

    #[test]
    fn test_without_timeout_disables_timeout() {
        let provider = OpenAiLlmProvider::new("test-key".to_string()).without_timeout();
        assert!(provider.timeout.is_none());
    }
}
