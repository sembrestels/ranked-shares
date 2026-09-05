use sealed::fixture::{hex_arr, hex_bytes, input_of, load_json};
use tally_prover::{keys, native};

#[test]
fn check_reproduces_the_fixture_and_keys_match() {
    let fx = load_json("fixture_main.json");
    let input = input_of(&fx);
    let dir = std::env::temp_dir().join(format!("tally-prover-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("main.bin");
    native::write_input(&path, &input).unwrap();
    let report = native::check(&path).unwrap();
    assert_eq!(hex::encode(report.output_hash), fx["outputHash"].as_str().unwrap().trim_start_matches("0x"));
    assert_eq!(report.voters, 18);

    let master: [u8; 32] = hex_arr(fx["master"].as_str().unwrap());
    let salt: [u8; 32] = hex_arr(fx["keySalt"].as_str().unwrap());
    assert_eq!(keys::pk_for(&master, &salt).unwrap().to_vec(), hex_bytes(fx["pk"].as_str().unwrap()));
    assert_eq!(keys::sk_for(&master, &salt), input.sk);

    // encrypt with a fresh nonce round-trips through the fixture key
    let pk: [u8; 33] = hex_arr(fx["pk"].as_str().unwrap());
    let voter: [u8; 20] = hex_arr(fx["voters"][0]["addr"].as_str().unwrap());
    let ranks = vec![1u8, 2, 3, 0];
    let ct = sealed::ballot::encrypt(&pk, &voter, &ranks, &keys::random_scalar()).unwrap();
    assert_eq!(sealed::ballot::decrypt(&input.sk, &voter, &ct, 4), Some(ranks));
    std::fs::remove_dir_all(dir).unwrap();
}
