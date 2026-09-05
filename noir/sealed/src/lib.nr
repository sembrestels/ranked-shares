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

mod sponge_tests {
    use super::{sponge, sponge_var};

    #[test]
    fn matches_reference_vectors() {
        // paste the "// sponge" block printed by reference/tools/noir_vectors.py here
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
