//! Native execution of the guest logic on an input file: what `check` prints and what
//! `export` and `submit` use to know the funded order.

use crate::{eyre, Result};
use sealed::types::TallyInput;
use sealed::{io, tally};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    pub inputs_hash: [u8; 32],
    pub pk: [u8; 33],
    pub funded_order: Vec<u8>,
    pub output_hash: [u8; 32],
    pub voters: usize,
}

/// Reads a framed input file (`u64 LE length ‖ bincode ‖ padding`) back into a `TallyInput`.
pub fn read_input(path: &Path) -> Result<TallyInput> {
    let framed = std::fs::read(path)?;
    if framed.len() < 8 {
        return Err(eyre!("input file too short"));
    }
    let len = u64::from_le_bytes(framed[..8].try_into().unwrap()) as usize;
    if framed.len() < 8 + len {
        return Err(eyre!("input file truncated"));
    }
    io::decode_input(&framed[8..8 + len]).map_err(|e| eyre!("cannot decode input: {e}"))
}

pub fn write_input(path: &Path, input: &TallyInput) -> Result<()> {
    std::fs::write(path, io::frame(&io::encode_input(input)))?;
    Ok(())
}

pub fn check(path: &Path) -> Result<Report> {
    let input = read_input(path)?;
    let out = tally::run(&input).map_err(|e| eyre!("guest logic rejected the input: {e}"))?;
    Ok(Report {
        inputs_hash: out.inputs_hash,
        pk: out.pk,
        funded_order: out.funded_order,
        output_hash: out.output_hash,
        voters: input.voters.len(),
    })
}

impl Report {
    pub fn print(&self) {
        println!("voters      {}", self.voters);
        println!("inputsHash  0x{}", hex::encode(self.inputs_hash));
        println!("pk          0x{}", hex::encode(self.pk));
        println!("fundedOrder {:?}", self.funded_order);
        println!("outputHash  0x{}", hex::encode(self.output_hash));
    }
}
