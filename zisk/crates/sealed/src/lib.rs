//! The zisk variant's guest logic, usable on the host as well: decrypt sealed ballots,
//! recompute the commitments, run PB-EAR, hash the result. `curve` and `hash` have a
//! `ziskos::zisklib` implementation on the guest target and a `k256`/`tiny-keccak` one
//! elsewhere; everything above them is one code path.

pub mod ballot;
pub mod commitments;
pub mod curve;
pub mod hash;
pub mod io;
pub mod keys;
pub mod tally;
pub mod types;

#[cfg(feature = "tools")]
pub mod fixture;
