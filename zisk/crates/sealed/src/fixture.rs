//! Fixture-loading helpers shared by the vector tests, the integration tests of the next
//! task and the `fixture-input` binary. Host-only: gated by the `tools` feature.

use std::path::PathBuf;

use crate::types::{TallyInput, VoterIn};

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

/// Reads a `TallyInput` out of one of the `reference/vectors/zisk/fixture_*.json` scenarios.
pub fn input_of(fx: &serde_json::Value) -> TallyInput {
    TallyInput {
        chain_id: fx["chainId"].as_u64().unwrap(),
        pool: hex_arr(fx["pool"].as_str().unwrap()),
        sk: hex_arr(fx["sk"].as_str().unwrap()),
        costs: fx["costs"].as_array().unwrap().iter().map(|c| hex_u64(c.as_str().unwrap())).collect(),
        total_weight: hex_u64(fx["totalWeight"].as_str().unwrap()),
        voters: fx["voters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| VoterIn {
                addr: hex_arr(v["addr"].as_str().unwrap()),
                direct_weight: hex_u64(v["directWeight"].as_str().unwrap()),
                seat_weight: hex_u64(v["seatWeight"].as_str().unwrap()),
                direct_ballot: hex_bytes(v["directBallot"].as_str().unwrap()),
                ciphertext: hex_bytes(v["ciphertext"].as_str().unwrap()),
            })
            .collect(),
    }
}
