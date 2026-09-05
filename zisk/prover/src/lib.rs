//! The operator's prover for the zisk variant (spec Z6). `main.rs` is the clap surface;
//! everything it does lives here so tests and the future service can call it.

pub mod chain;
pub mod keys;
pub mod native;

pub use eyre::{eyre, Result};
