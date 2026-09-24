//! Deterministic encoding and decoding for the official Pi JSONL RPC.
//!
//! The host owns the `pi` process. This module only validates commands and
//! classifies stdout records so both desktop hosts share one protocol.

mod protocol;

pub use protocol::{
    PiCommand, PiEvent, PiParseError, PiResponse, PiRpcRecord, PiSessionEvent, PiToolEvent,
};
