//! Sealed-ballot primitives for the RankedShares circuits (spec B4, B6.1, B7).
//! Every function mirrors a function of the Python reference in `reference/`.

use std::embedded_curve_ops::{
    EmbeddedCurvePoint, EmbeddedCurveScalar, fixed_base_scalar_mul, multi_scalar_mul,
};
use std::hash::poseidon2_permutation;

pub global RATE: u32 = 3;
pub global TWO_POW_64: Field = 18446744073709551616;
pub global DOMAIN: Field = 0x52616e6b65645368617265732f7365616c65642f7632;
pub global GEN_X: Field = 1;
pub global GEN_Y: Field = 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272c;
pub global NONE: u64 = 18446744073709551615;

/// Poseidon2 sponge over BN254, t = 4, rate 3: Barretenberg's FieldSponge, as
/// `reference/poseidon2.py::hash`.
pub fn sponge<let N: u32>(inputs: [Field; N]) -> Field {
    let mut state = [0, 0, 0, (N as Field) * TWO_POW_64];
    for i in 0..N {
        if (i > 0) & (i % RATE == 0) {
            state = poseidon2_permutation(state);
        }
        state[i % RATE] += inputs[i];
    }
    poseidon2_permutation(state)[0]
}

/// Sponge over the first `len` elements of `inputs` (`len <= N`), with `len` in the
/// capacity element, so it equals `sponge` of the shorter array. Used for `costsHash`
/// (m elements) and transcript steps (m + 4 elements) where `m` is a runtime value.
pub fn sponge_var<let N: u32>(inputs: [Field; N], len: u32) -> Field {
    assert(len <= N);
    let mut state = [0, 0, 0, (len as Field) * TWO_POW_64];
    for i in 0..N {
        let active = i < len;
        if (i > 0) & (i % RATE == 0) {
            let permuted = poseidon2_permutation(state);
            state = if active { permuted } else { state };
        }
        let x = if active { inputs[i] } else { 0 };
        state[i % RATE] += x;
    }
    poseidon2_permutation(state)[0]
}

/// Bytes of a packed ballot and whether it is a competition ranking over `m`
/// projects: `packed < 256^m`, every rank `<= m`, and a rank `r` is used only if
/// exactly `r - 1` projects carry a smaller non-zero rank (`PBEAR._setBallot`).
pub fn unpack_and_validate<let M: u32>(packed: Field, m: u32) -> (bool, [u8; M]) {
    assert(m <= M);
    let bytes: [u8; 32] = packed.to_le_bytes();
    let mut ranks: [u8; M] = [0; M];
    let mut ok = true;
    for c in 0..32 {
        let in_range = c < m;
        let byte = bytes[c];
        // bytes at or beyond m must be zero
        ok &= in_range | (byte == 0);
        if c < M {
            ranks[c] = byte;
            ok &= (!in_range) | (byte as u32 <= m);
        }
    }
    // counts[r] for r in 1..=M
    let mut counts: [u32; M + 1] = [0; M + 1];
    for c in 0..M {
        let r = ranks[c] as u32;
        for k in 0..M + 1 {
            counts[k] += if (c < m) & (r == k) { 1 } else { 0 };
        }
    }
    let mut seen: u32 = 0;
    for r in 1..M + 1 {
        let used = counts[r] != 0;
        ok &= (!used) | (r == seen + 1);
        seen += counts[r];
    }
    (ok, ranks)
}

/// The rank used by the tally: the stored rank, or `1 + number of ranked projects`
/// for an unranked one (`PBEAR._defaultRank`).
pub fn effective_ranks<let M: u32>(ranks: [u8; M], m: u32) -> [u8; M] {
    assert(m <= M);
    let mut nonzero: u32 = 0;
    for c in 0..M {
        nonzero += if (c < m) & (ranks[c] != 0) { 1 } else { 0 };
    }
    let default = (nonzero + 1) as u8;
    let mut out: [u8; M] = [0; M];
    for c in 0..M {
        out[c] = if ranks[c] == 0 { default } else { ranks[c] };
    }
    out
}

/// `sk · R`, with a zero `rx` (an empty slot) replaced by the generator so the
/// black box always sees a valid point. The caller discards the result in that case.
pub fn shared_point(sk: EmbeddedCurveScalar, rx: Field, ry: Field) -> EmbeddedCurvePoint {
    let empty = rx == 0;
    let x = if empty { GEN_X } else { rx };
    let y = if empty { GEN_Y } else { ry };
    multi_scalar_mul([EmbeddedCurvePoint::new(x, y)], [sk])
}

/// `Poseidon2([DOMAIN, S.x, S.y, voter])` (spec B4).
pub fn mask(shared: EmbeddedCurvePoint, voter: Field) -> Field {
    sponge([DOMAIN, shared.x, shared.y, voter])
}

/// Decrypt one sealed ballot: (valid, packed). Absent ballots return (false, 0).
pub fn decrypt<let M: u32>(
    sk: EmbeddedCurveScalar,
    rx: Field,
    ry: Field,
    c: Field,
    voter: Field,
    m: u32,
) -> (bool, Field) {
    let s = shared_point(sk, rx, ry);
    let packed = c - mask(s, voter);
    let (ok, _) = unpack_and_validate::<M>(packed, m);
    let valid = ok & (rx != 0);
    (valid, if valid { packed } else { 0 })
}

/// `sk · G == pk`.
pub fn pk_matches(sk: EmbeddedCurveScalar, pk_x: Field, pk_y: Field) -> bool {
    let p = fixed_base_scalar_mul(sk);
    (p.x == pk_x) & (p.y == pk_y)
}

mod sponge_tests {
    use super::{sponge, sponge_var};

    #[test]
    fn matches_reference_vectors() {
        assert(sponge([1]) == 0x168758332d5b3e2d13be8048c8011b454590e06c44bce7f702f09103eef5a373);
        assert(
            sponge([1, 2, 3]) == 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8,
        );
        assert(
            sponge([1, 2, 3, 4])
                == 0x130bf204a32cac1f0ace56c78b731aa3809f06df2731ebcf6b3464a15788b1b9,
        );
        assert(
            sponge([1, 2, 3, 4, 5, 6])
                == 0x7f57fcda925c06dc0a311f3f17fa0218e079b514552744a25ba8a74ee8c9e7a,
        );
        assert(
            sponge_var([0; 4], 0)
                == 0x18dfb8dc9b82229cff974efefc8df78b1ce96d9d844236b496785c698bc6732e,
        );
    }

    #[test]
    fn var_length_equals_fixed_length() {
        assert(sponge_var([1, 2, 3, 0, 0], 3) == sponge([1, 2, 3]));
        assert(sponge_var([1, 2, 3, 4, 0, 0, 0], 4) == sponge([1, 2, 3, 4]));
        assert(sponge_var([7, 0, 0], 1) == sponge([7]));
    }

    #[test]
    fn length_is_part_of_the_hash() {
        assert(sponge([1]) != sponge([1, 0]));
        assert(sponge_var([1, 0], 1) != sponge_var([1, 0], 2));
    }
}

mod ballot_tests {
    use super::{decrypt, effective_ranks, pk_matches, unpack_and_validate};
    use std::embedded_curve_ops::EmbeddedCurveScalar;

    #[test]
    fn unpacks_valid_ballots() {
        let (ok, ranks) = unpack_and_validate::<4>(0x03000102, 4); // [2, 1, 0, 3]
        assert(ok);
        assert(ranks == [2, 1, 0, 3]);
        let (ok0, _) = unpack_and_validate::<4>(0, 4); // all unranked
        assert(ok0);
        let (ok2, _) = unpack_and_validate::<4>(0x0202, 2); // [2, 2] for m = 2
        assert(!ok2);
    }

    #[test]
    fn rejects_invalid_ballots() {
        let (too_wide, _) = unpack_and_validate::<4>((1u64 << 32) as Field, 4);
        assert(!too_wide);
        let (rank_gt_m, _) = unpack_and_validate::<4>(0x05, 4);
        assert(!rank_gt_m);
        let (gap, _) = unpack_and_validate::<4>(0x00030301, 4); // [1, 3, 3, 0]
        assert(!gap);
        let (beyond_m, _) = unpack_and_validate::<4>(0x01000000, 3); // byte 3 set, m = 3
        assert(!beyond_m);
    }

    #[test]
    fn effective_ranks_fill_the_last_tier() {
        assert(effective_ranks::<4>([2, 1, 0, 3], 4) == [2, 1, 4, 3]);
        assert(effective_ranks::<4>([0, 0, 0, 0], 4) == [1, 1, 1, 1]);
        assert(effective_ranks::<4>([1, 0, 0, 0], 2) == [1, 2, 2, 2]);
    }

    // Values from reference/vectors/sealed.json (printed by reference/tools/noir_vectors.py).
    global SK: EmbeddedCurveScalar = EmbeddedCurveScalar {
        lo: 0x86f0a28f12908cda56ee68f492a02a19,
        hi: 0x83abad4ae815c27ae5035ddfb0520ea,
    };

    #[test]
    fn pk_matches_the_vector_key() {
        assert(pk_matches(
            SK,
            0x00e5f53c9afed1f9c1ef822bf03df8b2be36af7882d6d45744d989c5c8200d91,
            0x21c72d415f8e1a34760b86ca7a4d871c7913b305ea6ff5c2d354966a84fab321,
        ));
        assert(!pk_matches(SK, 1, 0x2cf135e7506a45d632d270d45f1181294833fc48d823f272c));
    }

    #[test]
    fn decrypts_the_first_vector() {
        let (ok, packed) = decrypt::<4>(
            SK,
            0x0656c259e26c7c93f06e5da9c501c3c5401ffa6514e0e3f30b91916b2bdcb084,
            0x2c42513bbb16004b692017ac1e0f82cffad63b648c5d2c55e53d4ae80672de49,
            0x2f996f763a3a50db39bec4b185cf0c74e7c2464e15f7d72da21ea40ca73dcb00,
            0x1111111111111111111111111111111111111111,
            4,
        );
        assert(ok);
        assert(packed == 0x03000102);
    }

    #[test]
    fn wrong_voter_is_absent() {
        let (ok, _) = decrypt::<4>(
            SK,
            0x0656c259e26c7c93f06e5da9c501c3c5401ffa6514e0e3f30b91916b2bdcb084,
            0x2c42513bbb16004b692017ac1e0f82cffad63b648c5d2c55e53d4ae80672de49,
            0x2f996f763a3a50db39bec4b185cf0c74e7c2464e15f7d72da21ea40ca73dcb00,
            0x2222222222222222222222222222222222222222,
            4,
        );
        assert(!ok);
    }

    #[test]
    fn zero_rx_is_absent_and_provable() {
        let (ok, packed) = decrypt::<4>(SK, 0, 0, 5, 0x1111111111111111111111111111111111111111, 4);
        assert(!ok);
        assert(packed == 0);
    }
}
