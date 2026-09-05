use pbear::{Entry, ingest_main, State};

global E: u32 = 8;
global M: u32 = 4;
global B: u32 = 2;

/// Public inputs, in order: k, n_sealed, m, budget, pk_x, pk_y, h_in, h_out, state_in,
/// state_out -- the order `SealedRankedShares._advanceIngest` checks them in. The body
/// is `pbear::ingest_main`, shared with the other profile.
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
    ingest_main::<E, M, B>(
        k,
        n_sealed,
        m,
        budget,
        pk_x,
        pk_y,
        h_in,
        h_out,
        state_in,
        state_out,
        sk_lo,
        sk_hi,
        state,
        entries,
    );
}
