use serde::{Deserialize, Serialize};

/// One registered voter as the contract holds it after `close` (spec Z4).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct VoterIn {
    pub addr: [u8; 20],
    pub direct_weight: u64,
    pub seat_weight: u64,
    /// `m` bytes, or empty when the voter cast no direct ballot.
    pub direct_ballot: Vec<u8>,
    /// `33 + m` bytes, or empty when the voter cast no sealed ballot.
    pub ciphertext: Vec<u8>,
}

/// The guest's private witness. bincode 2 `standard()` encoding, framed by `io::frame`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TallyInput {
    pub chain_id: u64,
    pub pool: [u8; 20],
    pub sk: [u8; 32],
    pub costs: Vec<u64>,
    pub total_weight: u64,
    pub voters: Vec<VoterIn>,
}

/// What `tally::run` computes. Only `output_hash` leaves the guest.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TallyOutput {
    pub inputs_hash: [u8; 32],
    pub pk: [u8; 33],
    pub funded_order: Vec<u8>,
    pub output_hash: [u8; 32],
}
