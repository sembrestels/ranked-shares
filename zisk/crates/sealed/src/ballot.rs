//! The sealed-ballot scheme of spec Z3, on top of `curve` and `hash`.

use crate::{curve, hash::keccak256};

pub const DOMAIN: &[u8] = b"RankedShares/sealed/secp256k1";

pub fn ballot_key(shared_x: &[u8; 32], voter: &[u8; 20]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(DOMAIN.len() + 52);
    buf.extend_from_slice(DOMAIN);
    buf.extend_from_slice(shared_x);
    buf.extend_from_slice(voter);
    keccak256(&buf)
}

pub fn pad(key: &[u8; 32], m: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(m + 32);
    for b in 0..m.div_ceil(32) {
        let mut buf = [0u8; 33];
        buf[..32].copy_from_slice(key);
        buf[32] = b as u8;
        out.extend_from_slice(&keccak256(&buf));
    }
    out.truncate(m);
    out
}

/// `R ‖ (ranks ⊕ pad)`. `ranks` is not validated (the fixtures encrypt garbage on purpose).
/// `None` only for a bad `pk` or `k`; used by tests and by plan B's tooling.
pub fn encrypt(pk: &[u8; 33], voter: &[u8; 20], ranks: &[u8], k: &[u8; 32]) -> Option<Vec<u8>> {
    let r = curve::pubkey(k)?;
    let sx = curve::shared_x(k, pk)?;
    let key = ballot_key(&sx, voter);
    let mut out = Vec::with_capacity(33 + ranks.len());
    out.extend_from_slice(&r);
    out.extend(ranks.iter().zip(pad(&key, ranks.len())).map(|(a, b)| a ^ b));
    Some(out)
}

/// The ranks, or `None` when the ballot is absent for any reason (spec Z4 step 3).
pub fn decrypt(sk: &[u8; 32], voter: &[u8; 20], ciphertext: &[u8], m: usize) -> Option<Vec<u8>> {
    if ciphertext.len() != 33 + m {
        return None;
    }
    let r: [u8; 33] = ciphertext[..33].try_into().unwrap();
    let sx = curve::shared_x(sk, &r)?;
    let key = ballot_key(&sx, voter);
    let ranks: Vec<u8> = ciphertext[33..].iter().zip(pad(&key, m)).map(|(a, b)| a ^ b).collect();
    pbear::validate(&ranks, m).then_some(ranks)
}
