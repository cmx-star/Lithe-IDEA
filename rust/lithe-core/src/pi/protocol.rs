//! Official `pi --mode rpc` records.
//!
//! Commands use the upstream JSONL shape. Stdout is split only on LF so a
//! Unicode line separator inside a JSON string cannot break one record.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// One command Lithe can send to an official Pi RPC process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PiCommand {
    /// Starts or queues one user prompt.
    Prompt {
        /// Caller-owned correlation ID copied by the matching response.
        id: String,
        /// User prompt text. File references are not expanded by Pi RPC.
        message: String,
    },
    /// Adds input to the active turn without starting another turn.
    Steer {
        /// Caller-owned correlation ID copied by the matching response.
        id: String,
        /// Steering text accepted at the next model boundary.
        message: String,
    },
    /// Requests cancellation of the active run.
    Abort {
        /// Caller-owned correlation ID copied by the matching response.
        id: String,
    },
}

impl PiCommand {
    /// Encodes one command as a single JSONL record, including its trailing LF.
    pub fn encode(&self) -> String {
        let (id, body) = match self {
            Self::Prompt { id, message } => (id, json!({ "type": "prompt", "message": message })),
            Self::Steer { id, message } => (id, json!({ "type": "steer", "message": message })),
            Self::Abort { id } => (id, json!({ "type": "abort" })),
        };
        let mut record = body;
        record
            .as_object_mut()
            .expect("command JSON is an object")
            .insert("id".to_string(), Value::String(id.clone()));
        format!("{record}\n")
    }
}

/// A command response correlated by its original command ID.
#[derive(Debug, Clone, PartialEq)]
pub struct PiResponse {
    /// ID supplied by the command, when Pi was able to parse one.
    pub id: Option<String>,
    /// Command name reported by Pi.
    pub command: String,
    /// Whether Pi accepted the command. This does not mean generation finished.
    pub success: bool,
    /// Command-specific data returned for a successful command.
    pub data: Option<Value>,
    /// Pi-supplied failure text.
    pub error: Option<String>,
}

/// Session activity emitted independently of command responses.
#[derive(Debug, Clone, PartialEq)]
pub enum PiSessionEvent {
    /// Incremental assistant text.
    TextDelta(String),
    /// Incremental assistant thinking text.
    ThinkingDelta(String),
    /// A tool call started or changed.
    Tool(PiToolEvent),
    /// One low-level model run ended. More recovery work may follow.
    AgentEnded,
    /// Pi will not continue this turn automatically.
    AgentSettled,
    /// A provider, tool, or runtime error that is safe to display.
    Error(String),
    /// A known session event that the first product surface does not render.
    Ignored,
}

/// The subset of tool activity needed by the chat surface.
#[derive(Debug, Clone, PartialEq)]
pub struct PiToolEvent {
    /// Tool call identifier assigned by Pi.
    pub id: String,
    /// Tool name.
    pub name: String,
    /// Whether this record starts the call or reports its result.
    pub phase: PiToolPhase,
    /// Tool arguments or result content.
    pub payload: Option<Value>,
    /// Whether the tool result is an error.
    pub is_error: bool,
}

/// Tool lifecycle phase carried by a session event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PiToolPhase {
    /// Pi has selected a tool and is waiting for its result.
    Started,
    /// Pi has received the tool result.
    Completed,
}

/// One decoded stdout record.
#[derive(Debug, Clone, PartialEq)]
pub enum PiRpcRecord {
    /// Response to one stdin command.
    Response(PiResponse),
    /// Session activity.
    Event(PiSessionEvent),
}

/// Failure while splitting or decoding one protocol record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PiParseError {
    /// Safe diagnostic for logs and tests.
    pub message: String,
}

impl PiParseError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct RawRecord {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default, rename = "assistantMessageEvent")]
    assistant_message_event: Option<AssistantMessageEvent>,
    #[serde(default, rename = "toolCallId")]
    tool_call_id: Option<String>,
    #[serde(default, rename = "toolName")]
    tool_name: Option<String>,
    #[serde(default)]
    args: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default, rename = "isError")]
    is_error: Option<bool>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AssistantMessageEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    delta: Option<String>,
}

/// Decodes one complete JSONL record. The caller removes the LF first.
pub fn decode_record(line: &str) -> Result<PiRpcRecord, PiParseError> {
    let raw: RawRecord = serde_json::from_str(line.trim_end_matches('\r'))
        .map_err(|error| PiParseError::new(format!("Pi RPC record is not valid JSON: {error}")))?;

    if raw.kind == "response" {
        return Ok(PiRpcRecord::Response(PiResponse {
            id: raw.id,
            command: raw.command.unwrap_or_else(|| "unknown".to_string()),
            success: raw.success.unwrap_or(false),
            data: raw.data,
            error: raw.error,
        }));
    }

    Ok(PiRpcRecord::Event(decode_event(raw)?))
}

fn decode_event(raw: RawRecord) -> Result<PiSessionEvent, PiParseError> {
    match raw.kind.as_str() {
        "message_update" => decode_message_update(raw.assistant_message_event),
        "tool_execution_start" | "tool_start" => Ok(PiSessionEvent::Tool(PiToolEvent {
            id: raw.tool_call_id.unwrap_or_default(),
            name: raw.tool_name.unwrap_or_else(|| "tool".to_string()),
            phase: PiToolPhase::Started,
            payload: raw.args,
            is_error: false,
        })),
        "tool_execution_end" | "tool_end" => Ok(PiSessionEvent::Tool(PiToolEvent {
            id: raw.tool_call_id.unwrap_or_default(),
            name: raw.tool_name.unwrap_or_else(|| "tool".to_string()),
            phase: PiToolPhase::Completed,
            payload: raw.result,
            is_error: raw.is_error.unwrap_or(false),
        })),
        "agent_end" => Ok(PiSessionEvent::AgentEnded),
        "agent_settled" => Ok(PiSessionEvent::AgentSettled),
        "error" => Ok(PiSessionEvent::Error(
            raw.error
                .or(raw.message)
                .unwrap_or_else(|| "Pi reported an unknown error.".to_string()),
        )),
        "agent_start"
        | "turn_start"
        | "turn_end"
        | "message_start"
        | "message_end"
        | "compaction"
        | "retry" => Ok(PiSessionEvent::Ignored),
        other => Err(PiParseError::new(format!(
            "Pi RPC record type is not supported: {other}"
        ))),
    }
}

fn decode_message_update(
    event: Option<AssistantMessageEvent>,
) -> Result<PiSessionEvent, PiParseError> {
    let Some(event) = event else {
        return Err(PiParseError::new(
            "Pi message_update did not include assistantMessageEvent.",
        ));
    };
    match event.kind.as_str() {
        "text_delta" => Ok(PiSessionEvent::TextDelta(event.delta.unwrap_or_default())),
        "thinking_delta" => Ok(PiSessionEvent::ThinkingDelta(
            event.delta.unwrap_or_default(),
        )),
        _ => Ok(PiSessionEvent::Ignored),
    }
}

/// Incremental stdout reader that emits records only on LF boundaries.
#[derive(Debug, Default)]
pub struct PiRpcReader {
    pending: Vec<u8>,
}

impl PiRpcReader {
    /// Creates an empty reader.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds stdout bytes and returns every record terminated by LF.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<PiRpcRecord>, PiParseError> {
        self.pending.extend_from_slice(bytes);
        let mut records = Vec::new();
        while let Some(index) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=index).collect();
            let text = String::from_utf8(line)
                .map_err(|_| PiParseError::new("Pi RPC stdout is not valid UTF-8."))?;
            if text.trim().is_empty() {
                continue;
            }
            records.push(decode_record(&text)?);
        }
        Ok(records)
    }
}

/// Stable frontend event emitted by the Rust host.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiEvent {
    /// Chat surface that owns the active turn.
    pub chat_id: String,
    /// Event kind consumed by the existing chat surface.
    pub kind: String,
    /// Text delta or user-facing error.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Tool call identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    /// Tool name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// Tool payload encoded as JSON text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<String>,
    /// Whether a tool result failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

impl PiEvent {
    /// Converts one session event into the frontend event, if it is visible.
    pub fn from_session(chat_id: &str, event: &PiSessionEvent) -> Option<Self> {
        let base = Self {
            chat_id: chat_id.to_string(),
            kind: String::new(),
            text: None,
            tool_id: None,
            tool_name: None,
            payload: None,
            is_error: None,
        };
        match event {
            PiSessionEvent::TextDelta(text) => Some(Self {
                kind: "text".to_string(),
                text: Some(text.clone()),
                ..base
            }),
            PiSessionEvent::ThinkingDelta(text) => Some(Self {
                kind: "thinking".to_string(),
                text: Some(text.clone()),
                ..base
            }),
            PiSessionEvent::Tool(tool) => Some(Self {
                kind: match tool.phase {
                    PiToolPhase::Started => "tool_start".to_string(),
                    PiToolPhase::Completed => "tool_end".to_string(),
                },
                tool_id: Some(tool.id.clone()),
                tool_name: Some(tool.name.clone()),
                payload: tool.payload.as_ref().map(ToString::to_string),
                is_error: Some(tool.is_error),
                ..base
            }),
            PiSessionEvent::Error(message) => Some(Self {
                kind: "error".to_string(),
                text: Some(message.clone()),
                ..base
            }),
            PiSessionEvent::AgentSettled => Some(Self {
                kind: "settled".to_string(),
                ..base
            }),
            PiSessionEvent::AgentEnded | PiSessionEvent::Ignored => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_prompt_as_one_jsonl_record() {
        let command = PiCommand::Prompt {
            id: "prompt-1".to_string(),
            message: "Review this repository".to_string(),
        };

        assert_eq!(
            command.encode(),
            "{\"id\":\"prompt-1\",\"message\":\"Review this repository\",\"type\":\"prompt\"}\n"
        );
    }

    #[test]
    fn accepts_a_prompt_without_treating_it_as_completion() {
        let record = decode_record(
            r#"{"id":"prompt-1","type":"response","command":"prompt","success":true}"#,
        )
        .expect("response");

        assert_eq!(
            record,
            PiRpcRecord::Response(PiResponse {
                id: Some("prompt-1".to_string()),
                command: "prompt".to_string(),
                success: true,
                data: None,
                error: None,
            })
        );
    }

    #[test]
    fn keeps_unicode_line_separators_inside_one_record() {
        let mut reader = PiRpcReader::new();
        let first = reader
            .push(br#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"line"#)
            .expect("partial");
        let second = reader
            .push("\u{2028}two\"}}\n".as_bytes())
            .expect("complete");

        assert!(first.is_empty());
        assert_eq!(
            second,
            vec![PiRpcRecord::Event(PiSessionEvent::TextDelta(
                "line\u{2028}two".to_string()
            ))]
        );
    }

    #[test]
    fn maps_tool_and_settlement_events() {
        let start = decode_record(
            r#"{"type":"tool_execution_start","toolCallId":"tool-1","toolName":"bash","args":{"command":"ls"}}"#,
        )
        .expect("tool");
        let settled = decode_record(r#"{"type":"agent_settled"}"#).expect("settled");

        assert_eq!(
            start,
            PiRpcRecord::Event(PiSessionEvent::Tool(PiToolEvent {
                id: "tool-1".to_string(),
                name: "bash".to_string(),
                phase: PiToolPhase::Started,
                payload: Some(json!({ "command": "ls" })),
                is_error: false,
            }))
        );
        assert_eq!(
            settled,
            PiRpcRecord::Event(PiSessionEvent::AgentSettled)
        );
    }
}
