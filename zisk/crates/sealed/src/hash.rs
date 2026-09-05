//! keccak-256: ZisK's accelerated `zisklib::keccak256` on the guest, tiny-keccak elsewhere.

#[cfg(target_os = "zkvm")]
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    ziskos::zisklib::keccak256(data)
}

#[cfg(not(target_os = "zkvm"))]
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    use tiny_keccak::{Hasher, Keccak};
    let mut h = Keccak::v256();
    h.update(data);
    let mut out = [0u8; 32];
    h.finalize(&mut out);
    out
}
