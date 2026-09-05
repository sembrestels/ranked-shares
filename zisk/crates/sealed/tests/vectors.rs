use sealed::fixture::*;
use sealed::{ballot, curve, hash};

#[test]
fn keccak_matches_known_digests() {
    assert_eq!(
        hex::encode(hash::keccak256(b"")),
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
    assert_eq!(
        hex::encode(hash::keccak256(b"abc")),
        "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
    );
}

#[test]
fn pubkey_matches_vectors() {
    let v = load_json("sealed.json");
    for case in v["vectors"].as_array().unwrap() {
        let sk: [u8; 32] = hex_arr(case["sk"].as_str().unwrap());
        let pk: [u8; 33] = hex_arr(case["pk"].as_str().unwrap());
        assert_eq!(curve::pubkey(&sk), Some(pk));
    }
}

#[test]
fn encrypt_and_decrypt_match_vectors() {
    let v = load_json("sealed.json");
    for case in v["vectors"].as_array().unwrap() {
        let sk: [u8; 32] = hex_arr(case["sk"].as_str().unwrap());
        let pk: [u8; 33] = hex_arr(case["pk"].as_str().unwrap());
        let k: [u8; 32] = hex_arr(case["k"].as_str().unwrap());
        let voter: [u8; 20] = hex_arr(case["voter"].as_str().unwrap());
        let m = case["m"].as_u64().unwrap() as usize;
        let ranks: Vec<u8> = case["ranks"].as_array().unwrap().iter().map(|r| r.as_u64().unwrap() as u8).collect();
        let ct = hex_bytes(case["ciphertext"].as_str().unwrap());
        assert_eq!(ballot::encrypt(&pk, &voter, &ranks, &k), Some(ct.clone()), "{case}");
        let expected = if pbear::validate(&ranks, m) { Some(ranks) } else { None };
        assert_eq!(ballot::decrypt(&sk, &voter, &ct, m), expected, "{case}");
    }
}

#[test]
fn garbage_is_absent() {
    let v = load_json("sealed.json");
    let case = &v["vectors"][0];
    let sk: [u8; 32] = hex_arr(case["sk"].as_str().unwrap());
    let voter: [u8; 20] = hex_arr(case["voter"].as_str().unwrap());
    let m = case["m"].as_u64().unwrap() as usize;
    let ct = hex_bytes(case["ciphertext"].as_str().unwrap());
    let mut other = voter;
    other[19] ^= 1;
    assert_eq!(ballot::decrypt(&sk, &other, &ct, m), None);
    assert_eq!(ballot::decrypt(&sk, &voter, &ct[..ct.len() - 1], m), None);
    let mut bad_prefix = ct.clone();
    bad_prefix[0] = 4;
    assert_eq!(ballot::decrypt(&sk, &voter, &bad_prefix, m), None);
    let mut x_too_big = ct.clone();
    x_too_big[1..33].copy_from_slice(&[0xff; 32]);
    assert_eq!(ballot::decrypt(&sk, &voter, &x_too_big, m), None);
    let mut off_curve = ct.clone();
    off_curve[1..33].copy_from_slice(&[0; 32]);
    off_curve[32] = 5; // x = 5 has no point
    assert_eq!(ballot::decrypt(&sk, &voter, &off_curve, m), None);
    assert_eq!(curve::pubkey(&[0u8; 32]), None);
}
