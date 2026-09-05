use pbear::{commit, ranks_of, State, Step, tally_step};
use sealed::sponge_var;

global E: u32 = 256;
global M: u32 = 16;
global K: u32 = 8;

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
    let m = state.m as u32;
    assert(m <= M);
    for c in 0..M {
        assert((c < m) | (costs[c] == 0));
    }
    let mut cost_fields: [Field; M] = [0; M];
    for c in 0..M {
        cost_fields[c] = costs[c] as Field;
    }
    assert(sponge_var(cost_fields, m) == costs_hash);
    assert(commit(state) == state_in);
    let ranks = ranks_of(state);
    let mut s = state;
    for i in 0..K {
        s = tally_step(s, costs, steps[i], ranks);
    }
    assert(commit(s) == state_out);
    assert((if s.done { 1 } else { 0 }) == done);
    assert(s.t_hash == t_hash_out);
    assert((s.funded_count as Field) == funded_count);
    assert(pbear::funded_order_packed(s) == funded_order_packed);
}
