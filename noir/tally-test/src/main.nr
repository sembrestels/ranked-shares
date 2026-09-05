use pbear::{State, Step, tally_main};

global E: u32 = 8;
global M: u32 = 4;
global K: u32 = 2;

/// Public inputs, in order: costs_hash, state_in, state_out, done, t_hash_out,
/// funded_count, funded_order_packed -- the order
/// `SealedRankedShares._advanceTally` checks them in. The body is
/// `pbear::tally_main`, shared with the other profile.
fn main(
    costs_hash: pub Field,
    state_in: pub Field,
    state_out: pub Field,
    done: pub Field,
    t_hash_out: pub Field,
    funded_count: pub Field,
    funded_order_packed: pub Field,
    costs: [u64; M],
    state: State<E, M>,
    steps: [Step<M>; K],
) {
    tally_main::<E, M, K>(
        costs_hash,
        state_in,
        state_out,
        done,
        t_hash_out,
        funded_count,
        funded_order_packed,
        costs,
        state,
        steps,
    );
}
