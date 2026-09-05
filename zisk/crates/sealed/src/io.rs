//! Encoding of the guest input: bincode 2 `standard()` (what `ziskos::io::read` decodes)
//! and the ZisK stdin frame the CLI and emulator expect in an input file.

use crate::types::TallyInput;

pub fn encode_input(input: &TallyInput) -> Vec<u8> {
    bincode::serde::encode_to_vec(input, bincode::config::standard()).expect("serialize")
}

pub fn decode_input(bytes: &[u8]) -> Result<TallyInput, String> {
    bincode::serde::decode_from_slice(bytes, bincode::config::standard())
        .map(|(v, _)| v)
        .map_err(|e| e.to_string())
}

/// `u64 LE length ‖ bytes ‖ zero padding to a multiple of 8` (ZiskStdin::write_slice).
pub fn frame(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + bytes.len() + 8);
    out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    out.extend_from_slice(bytes);
    let pad = (8 - out.len() % 8) % 8;
    out.resize(out.len() + pad, 0);
    out
}
