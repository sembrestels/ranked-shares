use tally_prover::pipeline::{expected_public_values, load_calldata};

#[test]
fn committed_calldata_loads_and_matches_the_fixture_layout() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let cd = load_calldata(&root.join("zisk/fixtures/main-calldata.json")).unwrap();
    assert_eq!(cd.public_values.len(), 2 + 1024);
    assert!(cd.funded_order.is_empty(), "the exporter's file carries no fundedOrder");
    let fx = sealed::fixture::load_json("fixture_main.json");
    let hash: [u8; 32] = sealed::fixture::hex_arr(fx["outputHash"].as_str().unwrap());
    let pv = hex::decode(cd.public_values.trim_start_matches("0x")).unwrap();
    assert_eq!(pv, expected_public_values(&hash));
}

#[test]
fn expected_public_values_layout() {
    let mut h = [0u8; 32];
    for (i, b) in h.iter_mut().enumerate() {
        *b = i as u8 + 1;
    }
    let pv = expected_public_values(&h);
    assert_eq!(pv.len(), 512);
    assert_eq!(&pv[..8], &[1, 2, 3, 4, 0, 0, 0, 0]);
    assert_eq!(&pv[56..64], &[29, 30, 31, 32, 0, 0, 0, 0]);
    assert!(pv[64..].iter().all(|&b| b == 0));
}
