//! Fixture-loading helpers shared by the vector tests, the integration tests of the next
//! task and the `fixture-input` binary. Host-only: gated by the `tools` feature.

use std::path::PathBuf;

pub fn hex_bytes(s: &str) -> Vec<u8> {
    let s = s.trim_start_matches("0x");
    if s.is_empty() {
        return Vec::new();
    }
    hex::decode(s).expect("hex")
}

pub fn hex_arr<const N: usize>(s: &str) -> [u8; N] {
    hex_bytes(s).try_into().expect("length")
}

pub fn hex_u64(s: &str) -> u64 {
    let b = hex_bytes(s);
    assert!(b.len() == 32 && b[..24].iter().all(|&x| x == 0), "fits u64");
    u64::from_be_bytes(b[24..].try_into().unwrap())
}

pub fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../reference/vectors/zisk")
}

pub fn load_json(name: &str) -> serde_json::Value {
    let text = std::fs::read_to_string(vectors_dir().join(name)).expect("fixture file");
    serde_json::from_str(&text).expect("json")
}
