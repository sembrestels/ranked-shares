//! The voter chain and `inputsHash` of spec Z5 (what `close` computes) and the ABI-encoded
//! output of spec Z4 step 5 (what `finalize` recomputes).

use crate::hash::keccak256;
use crate::types::VoterIn;

pub fn w32(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&v.to_be_bytes());
    out
}

pub fn voter_chain(voters: &[VoterIn]) -> [u8; 32] {
    let mut h = [0u8; 32];
    for v in voters {
        let mut buf = Vec::with_capacity(180);
        buf.extend_from_slice(&h);
        buf.extend_from_slice(&v.addr);
        buf.extend_from_slice(&w32(v.direct_weight));
        buf.extend_from_slice(&w32(v.seat_weight));
        buf.extend_from_slice(&keccak256(&v.direct_ballot));
        buf.extend_from_slice(&keccak256(&v.ciphertext));
        h = keccak256(&buf);
    }
    h
}

pub fn costs_hash(costs: &[u64]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(32 * costs.len());
    for &c in costs {
        buf.extend_from_slice(&w32(c));
    }
    keccak256(&buf)
}

pub fn inputs_hash(chain_id: u64, pool: &[u8; 20], chain: &[u8; 32], n: u64, costs: &[u64], total_weight: u64) -> [u8; 32] {
    let mut buf = Vec::with_capacity(32 + 20 + 32 + 32 + 32 + 32);
    buf.extend_from_slice(&w32(chain_id));
    buf.extend_from_slice(pool);
    buf.extend_from_slice(chain);
    buf.extend_from_slice(&w32(n));
    buf.extend_from_slice(&costs_hash(costs));
    buf.extend_from_slice(&w32(total_weight));
    keccak256(&buf)
}

/// `abi.encode(bytes32 inputsHash, bytes pk, uint256[] fundedOrder)`.
pub fn abi_encode_output(inputs_hash: &[u8; 32], pk: &[u8], funded: &[u8]) -> Vec<u8> {
    let pk_padded = pk.len().div_ceil(32) * 32;
    let mut out = Vec::with_capacity(96 + 32 + pk_padded + 32 + 32 * funded.len());
    out.extend_from_slice(inputs_hash);
    out.extend_from_slice(&w32(0x60));
    out.extend_from_slice(&w32(0x60 + 32 + pk_padded as u64));
    out.extend_from_slice(&w32(pk.len() as u64));
    out.extend_from_slice(pk);
    out.resize(out.len() + pk_padded - pk.len(), 0);
    out.extend_from_slice(&w32(funded.len() as u64));
    for &id in funded {
        out.extend_from_slice(&w32(id as u64));
    }
    out
}

pub fn output_hash(inputs_hash: &[u8; 32], pk: &[u8], funded: &[u8]) -> [u8; 32] {
    keccak256(&abi_encode_output(inputs_hash, pk, funded))
}
