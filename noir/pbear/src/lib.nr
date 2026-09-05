//! Circuit model of the sealed block's tally state (spec B7), mirroring
//! reference/commitments.py: State, commit, ingest, tally_step.

use sealed::{decrypt, effective_ranks, NONE, pk_matches, sponge, sponge_var, unpack_and_validate};
use std::embedded_curve_ops::EmbeddedCurveScalar;

pub struct State<let E: u32, let M: u32> {
    pub weights: [u64; E],
    pub ballots: [Field; E],
    pub funded: [bool; M],
    pub funded_order: [u8; M],
    pub funded_count: u8,
    pub level: u8,
    pub spent: u64,
    pub done: bool,
    pub m: u8,
    pub budget: u64,
    pub t_hash: Field,
}

pub struct Step<let M: u32> {
    pub level: u8,
    pub pub_support: [u64; M],
    pub best: u64,
    pub total: u64,
}

pub struct Entry {
    pub addr: Field,
    pub seat_weight: u64,
    pub rx: Field,
    pub ry: Field,
    pub c: Field,
}

pub fn empty_state<let E: u32, let M: u32>(m: u32, budget: u64) -> State<E, M> {
    State {
        weights: [0; E],
        ballots: [0; E],
        funded: [false; M],
        funded_order: [0; M],
        funded_count: 0,
        level: 1,
        spent: 0,
        done: false,
        m: m as u8,
        budget,
        t_hash: 0,
    }
}

pub fn funded_bits<let E: u32, let M: u32>(s: State<E, M>) -> Field {
    let mut bits: Field = 0;
    let mut pow: Field = 1;
    for c in 0..M {
        bits += if s.funded[c] { pow } else { 0 };
        pow *= 2;
    }
    bits
}

pub fn funded_order_packed<let E: u32, let M: u32>(s: State<E, M>) -> Field {
    let mut packed: Field = 0;
    let mut pow: Field = 1;
    for j in 0..M {
        packed += if (j as u8) < s.funded_count {
            (s.funded_order[j] as Field) * pow
        } else {
            0
        };
        pow *= 256;
    }
    packed
}

/// Poseidon2 over [weights, ballots, fundedBits, fundedOrderPacked, funded_count, level,
/// spent, done, m, budget, t_hash]: 2E + 9 elements.
pub fn commit<let E: u32, let M: u32>(s: State<E, M>) -> Field {
    let mut flat: [Field; 2 * E + 9] = [0; 2 * E + 9];
    for e in 0..E {
        flat[e] = s.weights[e] as Field;
        flat[E + e] = s.ballots[e];
    }
    flat[2 * E] = funded_bits(s);
    flat[2 * E + 1] = funded_order_packed(s);
    flat[2 * E + 2] = s.funded_count as Field;
    flat[2 * E + 3] = s.level as Field;
    flat[2 * E + 4] = s.spent as Field;
    flat[2 * E + 5] = if s.done { 1 } else { 0 };
    flat[2 * E + 6] = s.m as Field;
    flat[2 * E + 7] = s.budget as Field;
    flat[2 * E + 8] = s.t_hash;
    sponge(flat)
}

/// Effective ranks of every entry, computed once per proof (ballots never change).
pub fn ranks_of<let E: u32, let M: u32>(s: State<E, M>) -> [[u8; M]; E] {
    let mut out: [[u8; M]; E] = [[0; M]; E];
    for e in 0..E {
        let (_, bytes) = unpack_and_validate::<M>(s.ballots[e], s.m as u32);
        out[e] = effective_ranks::<M>(bytes, s.m as u32);
    }
    out
}

fn exhausted<let E: u32, let M: u32>(s: State<E, M>, costs: [u64; M]) -> bool {
    let mut all = true;
    for c in 0..M {
        let relevant = (c as u8) < s.m;
        let affordable = s.spent + costs[c] <= s.budget;
        all &= (!relevant) | s.funded[c] | (!affordable);
    }
    all
}

unconstrained fn div_hint(a: u64, b: u64, d: u64) -> (u64, u64) {
    let p = (a as u128) * (b as u128);
    ((p / (d as u128)) as u64, (p % (d as u128)) as u64)
}

/// floor(a * b / d) for u64 inputs, d != 0.
pub fn mul_div(a: u64, b: u64, d: u64) -> u64 {
    // Safety: q and r are fixed uniquely by the equation and the range check below.
    let (q, r) = unsafe { div_hint(a, b, d) };
    assert((q as Field) * (d as Field) + (r as Field) == (a as Field) * (b as Field));
    assert(r < d);
    q
}

/// One PB-EAR step over the sealed block, driven by a transcript step (spec B7).
/// A done or exhausted state absorbs nothing. Every assert is masked by `active`, so a
/// proof over a done state is always possible; a wrong transcript step over an active
/// state is not.
pub fn tally_step<let E: u32, let M: u32>(
    s: State<E, M>,
    costs: [u64; M],
    step: Step<M>,
    ranks: [[u8; M]; E],
) -> State<E, M> {
    let m = s.m as u32;
    let was_done = s.done;
    let is_exhausted = exhausted(s, costs);
    let active = (!was_done) & (!is_exhausted);
    assert((!active) | (step.level == s.level));

    // transcript hash over [t, level, pub_support[0..m), best, total] (m + 4 elements)
    let mut elems: [Field; M + 4] = [0; M + 4];
    elems[0] = s.t_hash;
    elems[1] = step.level as Field;
    for idx in 2..M + 4 {
        let c = idx - 2;
        elems[idx] = if c < m {
            step.pub_support[c] as Field
        } else if c == m {
            step.best as Field
        } else if c == m + 1 {
            step.total as Field
        } else {
            0
        };
    }
    let t_next = sponge_var(elems, m + 4);

    // sealed support at this level
    let mut sealed_support: [u64; M] = [0; M];
    for e in 0..E {
        for c in 0..M {
            let approves = (ranks[e][c] <= s.level) & (!s.funded[c]) & (c < m);
            sealed_support[c] += if approves { s.weights[e] } else { 0 };
        }
    }
    // argmax: highest sum, then lowest cost, then lowest id
    let mut best: u64 = NONE;
    let mut best_sum: u64 = 0;
    let mut best_cost: u64 = 0;
    for c in 0..M {
        let sum = step.pub_support[c] + sealed_support[c];
        let eligible = (c < m) & (!s.funded[c]) & (sum >= costs[c]);
        let better =
            (best == NONE) | (sum > best_sum) | ((sum == best_sum) & (costs[c] < best_cost));
        if eligible & better {
            best = c as u64;
            best_sum = sum;
            best_cost = costs[c];
        }
    }
    assert((!active) | (step.best == best));
    let none = best == NONE;
    assert((!active) | (!none) | (step.total == 0));
    assert((!active) | none | (step.total == best_sum));

    // reweighting of the sealed supporters, cumulative rounding from pub_support[best]
    let funding = active & (!none);
    let mut pub_best: u64 = 0;
    let mut supports_best_col: [bool; E] = [false; E];
    for c in 0..M {
        if (c as u64) == best {
            pub_best = step.pub_support[c];
        }
    }
    for e in 0..E {
        let mut supports = false;
        for c in 0..M {
            supports |= ((c as u64) == best) & (ranks[e][c] <= s.level);
        }
        supports_best_col[e] = supports & (s.weights[e] != 0);
    }
    let divisor = if funding { step.total } else { 1 };
    let mut weights = s.weights;
    let mut cum: u64 = pub_best;
    for e in 0..E {
        let take = funding & supports_best_col[e];
        let new_cum = cum + weights[e];
        let deduct = mul_div(new_cum, best_cost, divisor) - mul_div(cum, best_cost, divisor);
        weights[e] = if take {
            weights[e] - deduct
        } else {
            weights[e]
        };
        cum = if take { new_cum } else { cum };
    }

    // new state
    let mut out = s;
    out.weights = weights;
    out.t_hash = if active { t_next } else { s.t_hash };
    // NONE branch
    let level_up = active & none & (s.level as u32 < m);
    let end_none = active & none & (s.level as u32 >= m);
    out.level = if level_up { s.level + 1 } else { s.level };
    // funding branch
    for c in 0..M {
        out.funded[c] = s.funded[c] | (funding & ((c as u64) == best));
    }
    for j in 0..M {
        out.funded_order[j] = if funding & ((j as u8) == s.funded_count) {
            best as u8
        } else {
            s.funded_order[j]
        };
    }
    out.funded_count = if funding {
        s.funded_count + 1
    } else {
        s.funded_count
    };
    out.spent = if funding {
        s.spent + best_cost
    } else {
        s.spent
    };
    let exhausted_after = exhausted(out, costs);
    out.done = was_done | is_exhausted | end_none | (funding & exhausted_after);
    out
}

/// Ingest batch `k`: absorb the batch's entries into the sealed chain from `h_in`,
/// decrypt them, write entries `k·B + j` of the state. Returns (state, h_out).
pub fn ingest_batch<let E: u32, let M: u32, let B: u32>(
    s: State<E, M>,
    sk: EmbeddedCurveScalar,
    k: u32,
    n_sealed: u32,
    h_in: Field,
    entries: [Entry; B],
) -> (State<E, M>, Field) {
    let mut out = s;
    let mut h = h_in;
    for j in 0..B {
        let i = k * B + j;
        let active = i < n_sealed;
        let e = entries[j];
        let h_next = sponge([h, e.addr, e.seat_weight as Field, e.rx, e.ry, e.c]);
        h = if active { h_next } else { h };
        let (valid, packed) = decrypt::<M>(sk, e.rx, e.ry, e.c, e.addr, s.m as u32);
        let use_it = active & valid;
        let weight = if use_it { e.seat_weight } else { 0 };
        let ballot = if use_it { packed } else { 0 };
        let idx = if active { i } else { 0 };
        let keep_w = out.weights[idx];
        let keep_b = out.ballots[idx];
        out.weights[idx] = if active { weight } else { keep_w };
        out.ballots[idx] = if active { ballot } else { keep_b };
    }
    (out, h)
}

pub fn check_key(sk: EmbeddedCurveScalar, pk_x: Field, pk_y: Field) {
    assert(pk_matches(sk, pk_x, pk_y));
}

mod tests {
    use super::{commit, empty_state, ranks_of, State, Step, tally_step};
    use sealed::NONE;

    // test profile: E = 8, M = 4
    fn example_state() -> State<8, 4> {
        let mut s = empty_state::<8, 4>(2, 100);
        s.weights[0] = 60;
        s.ballots[0] = 0x0102; // [2, 1]
        s
    }

    #[test]
    fn empty_state_commit_matches_reference() {
        assert(
            commit(empty_state::<8, 4>(2, 100))
                == 0x1fb17e920d40fb7f02cbce8aab3e3efded4e7e3eeb99b04395c092d74bcbdfc3,
        );
    }

    #[test]
    fn ingested_state_commit_matches_reference() {
        assert(
            commit(example_state())
                == 0x135eb70676fa7070900a3c6e77ba18e3b79f31bc84c2db7614f451c595a05ae9,
        );
    }

    #[test]
    fn follows_the_transcript_to_done() {
        let costs = [30, 70, 0, 0];
        let mut s = example_state();
        let ranks = ranks_of(s);
        // step 0: level 1, pub [40, 0], best 0, total 40
        s = tally_step(
            s,
            costs,
            Step { level: 1, pub_support: [40, 0, 0, 0], best: 0, total: 40 },
            ranks,
        );
        assert(s.funded[0]);
        assert(s.weights[0] == 60);
        // step 1: level 1, pub [0, 0], NONE
        s = tally_step(
            s,
            costs,
            Step { level: 1, pub_support: [0, 0, 0, 0], best: NONE, total: 0 },
            ranks,
        );
        assert(s.level == 2);
        // step 2: level 2, pub [0, 10], best 1, total 70
        s = tally_step(
            s,
            costs,
            Step { level: 2, pub_support: [0, 10, 0, 0], best: 1, total: 70 },
            ranks,
        );
        assert(s.done);
        assert(s.weights[0] == 0);
        assert(s.spent == 100);
        assert(s.funded_count == 2);
        assert(commit(s) == 0x12a8fea21747f47ef4fd23e5f378b276ac5d6ff17a6fd8ad352b8d3ab09c3efe);
        assert(s.t_hash == 0xb7b3941a1edf6e27602db80ed9c15cea40f3d320767c62e22fbe2498d85c5cc);
    }

    #[test]
    fn done_state_ignores_steps() {
        let costs = [5, 0, 0, 0];
        let mut s = empty_state::<8, 4>(1, 10);
        s.done = true;
        let before = commit(s);
        let after = tally_step(
            s,
            costs,
            Step { level: 1, pub_support: [0; 4], best: NONE, total: 0 },
            ranks_of(s),
        );
        assert(commit(after) == before);
    }

    #[test]
    fn exhausted_state_becomes_done_without_absorbing() {
        let costs = [50, 0, 0, 0];
        let s = empty_state::<8, 4>(1, 10);
        let after = tally_step(
            s,
            costs,
            Step { level: 1, pub_support: [0; 4], best: NONE, total: 0 },
            ranks_of(s),
        );
        assert(after.done);
        assert(after.t_hash == 0);
    }

    #[test(should_fail)]
    fn forged_best_is_rejected() {
        let costs = [30, 70, 0, 0];
        let s = example_state();
        let _ = tally_step(
            s,
            costs,
            Step { level: 1, pub_support: [40, 0, 0, 0], best: 1, total: 40 },
            ranks_of(s),
        );
    }

    #[test(should_fail)]
    fn forged_total_is_rejected() {
        let costs = [30, 70, 0, 0];
        let s = example_state();
        let _ = tally_step(
            s,
            costs,
            Step { level: 1, pub_support: [40, 0, 0, 0], best: 0, total: 41 },
            ranks_of(s),
        );
    }

    #[test(should_fail)]
    fn wrong_level_is_rejected() {
        let costs = [30, 70, 0, 0];
        let s = example_state();
        let _ = tally_step(
            s,
            costs,
            Step { level: 2, pub_support: [40, 0, 0, 0], best: 0, total: 40 },
            ranks_of(s),
        );
    }
}
