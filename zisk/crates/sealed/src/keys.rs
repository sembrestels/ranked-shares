//! Tallier key derivation (spec Z3): `sk = keccak256(master ‖ keySalt) mod n`, with n the
//! secp256k1 group order. Dependency-free so it compiles on both targets; the reduction
//! is a conditional subtraction over four little-endian u64 limbs.

use crate::hash::keccak256;

/// secp256k1 group order, little-endian u64 limbs.
const N: [u64; 4] = [0xBFD25E8CD0364141, 0xBAAEDCE6AF48A03B, 0xFFFFFFFFFFFFFFFE, 0xFFFFFFFFFFFFFFFF];

pub fn derive_sk(master: &[u8; 32], salt: &[u8; 32]) -> [u8; 32] {
    let mut buf = [0u8; 64];
    buf[..32].copy_from_slice(master);
    buf[32..].copy_from_slice(salt);
    reduce_mod_n(&keccak256(&buf))
}

fn geq(a: &[u64; 4], b: &[u64; 4]) -> bool {
    for i in (0..4).rev() {
        if a[i] != b[i] {
            return a[i] > b[i];
        }
    }
    true
}

fn sub_assign(a: &mut [u64; 4], b: &[u64; 4]) {
    let mut borrow = 0u64;
    for i in 0..4 {
        let (d, b1) = a[i].overflowing_sub(b[i]);
        let (d, b2) = d.overflowing_sub(borrow);
        a[i] = d;
        borrow = (b1 | b2) as u64;
    }
}

/// `x mod n` for a 256-bit big-endian `x`. Since `n > 2^255`, `x < 2^256 < 2n`, so one
/// conditional subtraction is a full reduction.
pub fn reduce_mod_n(x: &[u8; 32]) -> [u8; 32] {
    let mut limbs = [0u64; 4];
    for i in 0..4 {
        limbs[i] = u64::from_be_bytes(x[32 - 8 * (i + 1)..32 - 8 * i].try_into().unwrap());
    }
    if geq(&limbs, &N) {
        sub_assign(&mut limbs, &N);
    }
    let mut out = [0u8; 32];
    for i in 0..4 {
        out[32 - 8 * (i + 1)..32 - 8 * i].copy_from_slice(&limbs[i].to_be_bytes());
    }
    out
}
