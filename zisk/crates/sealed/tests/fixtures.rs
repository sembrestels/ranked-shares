use sealed::fixture::*;
use sealed::{commitments, io, tally};

const SCENARIOS: [&str; 3] = ["main", "nosealed", "nodirect"];

#[test]
fn commitments_match_every_fixture() {
    for s in SCENARIOS {
        let fx = load_json(&format!("fixture_{s}.json"));
        let input = input_of(&fx);
        let chain = commitments::voter_chain(&input.voters);
        assert_eq!(hex::encode(chain), fx["voterChain"].as_str().unwrap().trim_start_matches("0x"), "{s}");
        let ih = commitments::inputs_hash(input.chain_id, &input.pool, &chain, input.voters.len() as u64, &input.costs, input.total_weight);
        assert_eq!(hex::encode(ih), fx["inputsHash"].as_str().unwrap().trim_start_matches("0x"), "{s}");
    }
}

#[test]
fn run_reproduces_every_fixture() {
    for s in SCENARIOS {
        let fx = load_json(&format!("fixture_{s}.json"));
        let out = tally::run(&input_of(&fx)).unwrap();
        let funded: Vec<u8> = fx["funded"].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect();
        assert_eq!(out.funded_order, funded, "{s}");
        assert_eq!(hex::encode(out.pk), fx["pk"].as_str().unwrap().trim_start_matches("0x"), "{s}");
        assert_eq!(hex::encode(out.output_hash), fx["outputHash"].as_str().unwrap().trim_start_matches("0x"), "{s}");
    }
}

#[test]
fn decryption_agrees_with_the_fixture_per_voter() {
    let fx = load_json("fixture_main.json");
    let input = input_of(&fx);
    for (v, j) in input.voters.iter().zip(fx["voters"].as_array().unwrap()) {
        if v.ciphertext.is_empty() {
            continue;
        }
        let expected: Option<Vec<u8>> = j["sealedRanks"].as_array().map(|a| a.iter().map(|r| r.as_u64().unwrap() as u8).collect());
        assert_eq!(sealed::ballot::decrypt(&input.sk, &v.addr, &v.ciphertext, input.costs.len()), expected, "{}", j["addr"]);
    }
}

#[test]
fn input_round_trips_through_bincode_and_the_frame() {
    let fx = load_json("fixture_main.json");
    let input = input_of(&fx);
    let bytes = io::encode_input(&input);
    assert_eq!(io::decode_input(&bytes).unwrap(), input);
    let framed = io::frame(&bytes);
    assert_eq!(&framed[..8], &(bytes.len() as u64).to_le_bytes());
    assert_eq!(framed.len() % 8, 0);
    assert_eq!(&framed[8..8 + bytes.len()], &bytes[..]);
}

#[test]
fn operator_errors_are_reported_not_panicked() {
    let fx = load_json("fixture_main.json");
    let mut input = input_of(&fx);
    input.sk = [0u8; 32];
    assert_eq!(tally::run(&input).unwrap_err(), tally::Error::InvalidKey);
    let mut input = input_of(&fx);
    input.total_weight = 0;
    assert_eq!(tally::run(&input).unwrap_err(), tally::Error::WeightsExceedBudget);
    let mut input = input_of(&fx);
    input.costs.clear();
    assert_eq!(tally::run(&input).unwrap_err(), tally::Error::BadCosts);
}

#[test]
fn voter_garbage_never_panics() {
    let fx = load_json("fixture_main.json");
    let mut input = input_of(&fx);
    for v in input.voters.iter_mut() {
        v.direct_ballot = vec![9; 3]; // wrong length and invalid
        v.ciphertext = vec![0xff; 33 + input.costs.len()];
    }
    let out = tally::run(&input).unwrap();
    assert!(out.funded_order.is_empty());
}

/// Runs the real guest in ziskemu. `cargo test -- --ignored` on a machine with ZisK.
#[test]
#[ignore]
fn guest_commits_the_fixture_hash_in_the_emulator() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    for s in SCENARIOS {
        let status = std::process::Command::new(root.join("scripts/emu-check.sh")).arg(s).status().expect("script runs");
        assert!(status.success(), "{s}");
    }
}
