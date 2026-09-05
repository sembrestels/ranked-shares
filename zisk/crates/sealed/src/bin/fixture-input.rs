//! fixture-input <fixture.json> <input.bin>
//! Writes a fixture as a framed guest input and prints what the guest must commit.

use sealed::fixture::input_of;
use sealed::{io, tally};
use std::process::exit;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: fixture-input <fixture.json> <input.bin>");
        exit(2);
    }
    let fx: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&args[1]).expect("read fixture")).expect("json");
    let input = input_of(&fx);
    std::fs::write(&args[2], io::frame(&io::encode_input(&input))).expect("write input");

    let out = tally::run(&input).expect("fixture input is valid");
    println!("inputsHash 0x{}", hex::encode(out.inputs_hash));
    println!("pk 0x{}", hex::encode(out.pk));
    println!("fundedOrder {:?}", out.funded_order);
    println!("outputHash 0x{}", hex::encode(out.output_hash));
    let expected = fx["outputHash"].as_str().unwrap().trim_start_matches("0x");
    if hex::encode(out.output_hash) != expected {
        eprintln!("native run disagrees with the fixture ({expected})");
        exit(1);
    }
}
