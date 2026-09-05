//! Operator key material: the master secret from `TALLIER_MASTER`, per-pool keys by salt.

use crate::{eyre, Result};

pub const MASTER_ENV: &str = "TALLIER_MASTER";

pub fn parse_hex32(s: &str) -> Result<[u8; 32]> {
    let bytes = hex::decode(s.trim().trim_start_matches("0x"))?;
    bytes.try_into().map_err(|_| eyre!("expected 32 bytes"))
}

pub fn master_from_env() -> Result<[u8; 32]> {
    let raw = std::env::var(MASTER_ENV).map_err(|_| eyre!("{MASTER_ENV} is not set"))?;
    parse_hex32(&raw)
}

pub fn sk_for(master: &[u8; 32], salt: &[u8; 32]) -> [u8; 32] {
    sealed::keys::derive_sk(master, salt)
}

pub fn pk_for(master: &[u8; 32], salt: &[u8; 32]) -> Result<[u8; 33]> {
    sealed::curve::pubkey(&sk_for(master, salt)).ok_or_else(|| eyre!("derived key is zero; choose another salt"))
}

/// A fresh random nonce below the group order, for `encrypt`.
pub fn random_scalar() -> [u8; 32] {
    use rand::RngCore;
    loop {
        let mut k = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut k);
        let k = sealed::keys::reduce_mod_n(&k);
        if k != [0u8; 32] {
            return k;
        }
    }
}
