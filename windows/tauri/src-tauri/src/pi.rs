//! Supervises one official `pi --mode rpc` process.
//!
//! Protocol decoding lives in `lithe-core`. This module only finds the user
//! installed executable, writes JSONL commands, and forwards visible events.

use lithe_core::pi::{PiCommand, PiEvent, PiParseError, PiRpcReader, PiRpcRecord, PiSessionEvent};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(15);

struct PiProcess {
    stdin: ChildStdin,
    child: Child,
    chat_id: String,
}

struct PiState {
    process: Option<PiProcess>,
    responses: mpsc::Receiver<PiRpcRecord>,
    response_sender: mpsc::Sender<PiRpcRecord>,
}

fn state() -> &'static Mutex<PiState> {
    static STATE: OnceLock<Mutex<PiState>> = OnceLock::new();
    STATE.get_or_init(|| {
        let (sender, receiver) = mpsc::channel();
        Mutex::new(PiState {
            process: None,
            responses: receiver,
            response_sender: sender,
        })
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiPromptRequest {
    chat_id: String,
    message: String,
    workspace_path: Option<String>,
}

#[tauri::command]
pub fn pi_status() -> Result<bool, String> {
    let state = lock_state()?;
    Ok(state.process.is_some())
}

#[tauri::command]
pub fn pi_prompt(
    app: AppHandle,
    chat_id: String,
    message: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    let request = PiPromptRequest {
        chat_id,
        message,
        workspace_path,
    };
    if request.message.trim().is_empty() {
        return Err("Enter a message before sending it to Pi.".to_string());
    }
    ensure_started(&app, &request)?;
    send_command(
        &app,
        PiCommand::Prompt {
            id: format!("prompt-{}", request.chat_id),
            message: request.message,
        },
    )
}

#[tauri::command]
pub fn pi_abort(app: AppHandle) -> Result<(), String> {
    let running = {
        let state = lock_state()?;
        state.process.is_some()
    };
    if !running {
        return Ok(());
    }
    send_command(
        &app,
        PiCommand::Abort {
            id: "abort-current".to_string(),
        },
    )
}

#[tauri::command]
pub fn pi_stop() -> Result<(), String> {
    let mut state = lock_state()?;
    stop_locked(&mut state)
}

fn ensure_started(app: &AppHandle, request: &PiPromptRequest) -> Result<(), String> {
    let mut state = lock_state()?;
    if state
        .process
        .as_ref()
        .is_some_and(|process| process.chat_id == request.chat_id)
    {
        return Ok(());
    }
    if let Some(process) = state.process.take() {
        stop_child(process)?;
    }

    let executable = find_pi_executable()?;
    let mut command = Command::new(executable);
    command
        .arg("--mode")
        .arg("rpc")
        .arg("--no-session")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(workspace) = request.workspace_path.as_deref() {
        if !workspace.is_empty() {
            command.current_dir(workspace);
        }
    }
    let mut child = command.spawn().map_err(|error| {
        format!("Pi could not be started. Check that the pi command works in a terminal. {error}")
    })?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Pi did not provide a command pipe.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Pi did not provide an event pipe.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Pi did not provide a diagnostic pipe.".to_string())?;

    let response_sender = state.response_sender.clone();
    let event_app = app.clone();
    let chat_id = request.chat_id.clone();
    thread::spawn(move || read_stdout(stdout, chat_id, event_app, response_sender));
    thread::spawn(move || read_stderr(stderr));

    state.process = Some(PiProcess {
        stdin,
        child,
        chat_id: request.chat_id.clone(),
    });
    Ok(())
}

fn send_command(app: &AppHandle, command: PiCommand) -> Result<(), String> {
    let encoded = command.encode();
    {
        let mut state = lock_state()?;
        let process = state
            .process
            .as_mut()
            .ok_or_else(|| "Pi is not running.".to_string())?;
        process
            .stdin
            .write_all(encoded.as_bytes())
            .map_err(|error| format!("The message could not be sent to Pi. {error}"))?;
        process
            .stdin
            .flush()
            .map_err(|error| format!("The message could not be sent to Pi. {error}"))?;
    }

    let deadline = std::time::Instant::now() + COMMAND_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            emit_error(app, "", "Pi did not accept the command before the deadline.");
            return Err("Pi did not accept the command before the deadline.".to_string());
        }
        let state = lock_state()?;
        match state.responses.recv_timeout(remaining) {
            Ok(PiRpcRecord::Response(response)) => {
                if response.success {
                    return Ok(());
                }
                let message = response
                    .error
                    .unwrap_or_else(|| "Pi rejected the command.".to_string());
                emit_error(app, "", &message);
                return Err(message);
            }
            Ok(PiRpcRecord::Event(_)) => continue,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                emit_error(app, "", "Pi did not accept the command before the deadline.");
                return Err("Pi did not accept the command before the deadline.".to_string());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Pi closed its event pipe.".to_string());
            }
        }
    }
}

fn read_stdout(
    stdout: impl std::io::Read + Send,
    chat_id: String,
    app: AppHandle,
    responses: mpsc::Sender<PiRpcRecord>,
) {
    let mut reader = BufReader::new(stdout);
    let mut decoder = PiRpcReader::new();
    let mut record = Vec::new();
    loop {
        record.clear();
        match reader.read_until(b'\n', &mut record) {
            Ok(0) => break,
            Ok(_) => match decoder.push(&record) {
                Ok(records) => {
                    for decoded in records {
                        forward_record(&chat_id, &app, &responses, decoded);
                    }
                }
                Err(error) => emit_parse_error(&app, &chat_id, &error),
            },
            Err(error) => {
                emit_error(&app, &chat_id, &format!("Pi stopped sending events. {error}"));
                break;
            }
        }
    }
}

fn forward_record(
    chat_id: &str,
    app: &AppHandle,
    responses: &mpsc::Sender<PiRpcRecord>,
    record: PiRpcRecord,
) {
    match &record {
        PiRpcRecord::Event(event) => {
            if let Some(frontend_event) = PiEvent::from_session(chat_id, event) {
                let _ = app.emit("pi-event", frontend_event);
            }
        }
        PiRpcRecord::Response(_) => {}
    }
    if matches!(record, PiRpcRecord::Response(_)) {
        let _ = responses.send(record);
    }
}

fn read_stderr(stderr: impl std::io::Read) {
    let reader = BufReader::new(stderr);
    for line in reader.lines().map_while(Result::ok) {
        eprintln!("[pi] {line}");
    }
}

fn emit_error(app: &AppHandle, chat_id: &str, message: &str) {
    let event = PiEvent::from_session(chat_id, &PiSessionEvent::Error(message.to_string()));
    if let Some(event) = event {
        let _ = app.emit("pi-event", event);
    }
}

fn emit_parse_error(app: &AppHandle, chat_id: &str, error: &PiParseError) {
    emit_error(app, chat_id, &error.message);
}

fn stop_locked(state: &mut PiState) -> Result<(), String> {
    if let Some(process) = state.process.take() {
        stop_child(process)?;
    }
    Ok(())
}

fn stop_child(mut process: PiProcess) -> Result<(), String> {
    if process.child.try_wait().ok().flatten().is_none() {
        process
            .child
            .kill()
            .map_err(|error| format!("Pi could not be stopped. {error}"))?;
        process
            .child
            .wait()
            .map_err(|error| format!("Pi could not be stopped. {error}"))?;
    }
    Ok(())
}

fn find_pi_executable() -> Result<String, String> {
    let command = if cfg!(windows) { "where" } else { "which" };
    let output = Command::new(command)
        .arg("pi")
        .output()
        .map_err(|_| "Pi is not installed. Install the official pi command and try again.".to_string())?;
    if !output.status.success() {
        return Err("Pi is not installed. Install the official pi command and try again.".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Pi is not installed. Install the official pi command and try again.".to_string())
}

fn lock_state() -> Result<std::sync::MutexGuard<'static, PiState>, String> {
    state().lock().map_err(|_| "Pi state is unavailable.".to_string())
}
