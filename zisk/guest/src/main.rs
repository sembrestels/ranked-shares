//! The zisk variant's guest (spec Z4): read the witness, run the whole tally, commit the
//! 32-byte output hash. Everything that can fail on voter data fails inside `run`
//! without panicking; `expect` here only fires on operator input.

#![no_main]
ziskos::entrypoint!(main);

use sealed::tally;
use sealed::types::TallyInput;

fn main() {
    let input: TallyInput = ziskos::io::read();
    let out = tally::run(&input).expect("operator input rejected");
    ziskos::io::commit_slice(&out.output_hash);
}
