use pbear::{check_key, commit, empty_state, Entry, ingest_batch, State};
use std::embedded_curve_ops::EmbeddedCurveScalar;

global E: u32 = 8;
global M: u32 = 4;
global B: u32 = 2;

/// `sk_lo`/`sk_hi` are deliberately not range-checked: the secret key is consumed only
/// by `pk_matches` and `shared_point`, which are the same embedded-curve black box and
/// read the same (lo, hi) limb pair the same way. Whatever scalar a witness's limbs
/// denote, `sk * G == pk` pins it to the key the pool committed to on chain, and `sk * R`
/// is then formed from that very scalar -- so an out-of-range encoding cannot make the
/// two uses disagree.
fn main(
    k: pub u32,
    n_sealed: pub u32,
    m: pub u32,
    budget: pub u64,
    pk_x: pub Field,
    pk_y: pub Field,
    h_in: pub Field,
    h_out: pub Field,
    state_in: pub Field,
    state_out: pub Field,
    sk_lo: Field,
    sk_hi: Field,
    state: State<E, M>,
    entries: [Entry; B],
) {
    let sk = EmbeddedCurveScalar { lo: sk_lo, hi: sk_hi };
    assert(m <= M);
    assert(n_sealed <= E);
    check_key(sk, pk_x, pk_y);
    let first = k == 0;
    assert((!first) | (state_in == 0));
    assert(first | (commit(state) == state_in));
    let start: State<E, M> = if first {
        empty_state::<E, M>(m, budget)
    } else {
        state
    };
    let (end, h) = ingest_batch::<E, M, B>(start, sk, k, n_sealed, h_in, entries);
    assert(h == h_out);
    assert(commit(end) == state_out);
}
