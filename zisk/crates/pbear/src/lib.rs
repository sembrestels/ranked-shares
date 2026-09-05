//! PB-EAR (Aziz & Lee) with the integer arithmetic of `PBEAR.sol`, over `u64` weights.
//!
//! Same voter order, same support sums, same argmax (highest support, then lowest cost,
//! then lowest id), same cumulative rounding in voter order, same termination. The
//! Solidity engine is the definition; `reference/pbear.py` is the executable oracle the
//! differential test in `tests/differential.rs` runs against.

/// One tally entry: a weight and, unless the entry abstains, a competition ranking.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub weight: u64,
    pub ranks: Option<Vec<u8>>,
}

/// `PBEAR._setBallot`'s check: length `m`, every rank `<= m`, no gaps.
pub fn validate(ranks: &[u8], m: usize) -> bool {
    if ranks.len() != m || ranks.iter().any(|&r| r as usize > m) {
        return false;
    }
    let mut counts = vec![0usize; m + 1];
    for &r in ranks {
        counts[r as usize] += 1;
    }
    let mut seen = 0usize;
    for r in 1..=m {
        if counts[r] != 0 && r != seen + 1 {
            return false;
        }
        seen += counts[r];
    }
    true
}

/// `floor(a * b / denominator)`, exact even when `a * b` overflows `u128`.
///
/// `PBEAR.sol` uses OpenZeppelin's `Math.mulDiv` (full 512-bit precision over `uint256`)
/// for this same division; Rust has no native `u256`, so this widens the product into a
/// 256-bit (hi, lo) pair by hand and long-divides it back down. `denominator` and the
/// quotient are assumed to fit in `u128`, which always holds here (`total` is a sum of
/// `u64` weights, and the result is a share of a `u64` cost).
fn mul_div(a: u128, b: u128, denominator: u128) -> u128 {
    assert!(denominator != 0, "mul_div: division by zero");
    const MASK: u128 = u64::MAX as u128;
    let (a_lo, a_hi) = (a & MASK, a >> 64);
    let (b_lo, b_hi) = (b & MASK, b >> 64);

    let ll = a_lo * b_lo;
    let lh = a_lo * b_hi;
    let hl = a_hi * b_lo;
    let hh = a_hi * b_hi;

    let mid = (ll >> 64) + (lh & MASK) + (hl & MASK);
    let lo = (mid << 64) | (ll & MASK);
    let hi = hh + (lh >> 64) + (hl >> 64) + (mid >> 64);

    if hi == 0 {
        return lo / denominator;
    }
    let mut remainder: u128 = 0;
    let mut quotient: u128 = 0;
    for i in (0..256).rev() {
        let bit = if i >= 128 { (hi >> (i - 128)) & 1 } else { (lo >> i) & 1 };
        remainder = (remainder << 1) | bit;
        if remainder >= denominator {
            remainder -= denominator;
            assert!(i < 128, "mul_div: quotient overflows u128");
            quotient |= 1 << i;
        }
    }
    quotient
}

/// Unranked projects (`0`) form the last tier: `1 +` the number of ranked projects.
pub fn effective_ranks(ranks: &[u8]) -> Vec<u16> {
    let default = 1 + ranks.iter().filter(|&&r| r != 0).count() as u16;
    ranks.iter().map(|&r| if r == 0 { default } else { r as u16 }).collect()
}

/// The funded projects in funding order.
///
/// `abstaining` is weight that belongs to the budget but never supports anything: money
/// behind voters without a usable ballot, unclaimed seats, division dust.
pub fn tally(costs: &[u64], entries: &[Entry], abstaining: u64) -> Vec<u8> {
    let m = costs.len();
    let mut weights: Vec<u64> = entries.iter().map(|e| e.weight).collect();
    let ranks: Vec<Option<Vec<u16>>> = entries
        .iter()
        .map(|e| {
            e.ranks.as_ref().map(|r| {
                assert!(validate(r, m), "invalid ballot handed to tally");
                effective_ranks(r)
            })
        })
        .collect();
    let budget: u128 = weights.iter().map(|&w| w as u128).sum::<u128>() + abstaining as u128;

    let mut funded: Vec<u8> = Vec::new();
    let mut is_funded = vec![false; m];
    let mut spent: u128 = 0;
    let mut level: u16 = 1;

    let exhausted = |is_funded: &[bool], spent: u128| {
        (0..m).all(|c| is_funded[c] || spent + costs[c] as u128 > budget)
    };

    while !exhausted(&is_funded, spent) {
        let mut support = vec![0u128; m];
        for (i, r) in ranks.iter().enumerate() {
            let Some(r) = r else { continue };
            if weights[i] == 0 {
                continue;
            }
            for c in 0..m {
                if !is_funded[c] && r[c] <= level {
                    support[c] += weights[i] as u128;
                }
            }
        }
        let mut best: Option<usize> = None;
        for c in 0..m {
            if is_funded[c] || support[c] < costs[c] as u128 {
                continue;
            }
            best = match best {
                None => Some(c),
                Some(b) if support[c] > support[b] || (support[c] == support[b] && costs[c] < costs[b]) => Some(c),
                keep => keep,
            };
        }
        let Some(b) = best else {
            if level as usize >= m {
                break;
            }
            level += 1;
            continue;
        };
        let supporters: Vec<usize> = (0..ranks.len())
            .filter(|&i| ranks[i].as_ref().is_some_and(|r| weights[i] != 0 && r[b] <= level))
            .collect();
        let total: u128 = supporters.iter().map(|&i| weights[i] as u128).sum();
        let cost = costs[b] as u128;
        let mut cum: u128 = 0;
        for &i in &supporters {
            let new_cum = cum + weights[i] as u128;
            let d = mul_div(new_cum, cost, total) - mul_div(cum, cost, total);
            weights[i] -= d as u64;
            cum = new_cum;
        }
        is_funded[b] = true;
        funded.push(b as u8);
        spent += cost;
    }
    funded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(weight: u64, ranks: &[u8]) -> Entry {
        Entry { weight, ranks: Some(ranks.to_vec()) }
    }

    #[test]
    fn validate_matches_pbear_sol() {
        assert!(validate(&[1, 2, 3, 0], 4));
        assert!(validate(&[1, 2, 2, 4], 4));
        assert!(validate(&[0, 0, 0, 0], 4));
        assert!(!validate(&[1, 3, 0, 0], 4));
        assert!(!validate(&[2, 2, 0, 0], 4));
        assert!(!validate(&[1, 2, 3], 4));
        assert!(!validate(&[1, 2, 3, 5], 4));
        assert!(!validate(&[4, 4, 4, 4], 4));
    }

    #[test]
    fn effective_ranks_put_unranked_last() {
        assert_eq!(effective_ranks(&[2, 1, 0, 0]), vec![2, 1, 3, 3]);
        assert_eq!(effective_ranks(&[0, 0]), vec![1, 1]);
    }

    #[test]
    fn readme_example() {
        // README "The algorithm": 30 + 70 costs, one 40 voter a>b, one 60 voter b>a, budget 100.
        let funded = tally(&[30, 70], &[e(40, &[1, 2]), e(60, &[2, 1])], 0);
        assert_eq!(funded, vec![0, 1]);
    }

    #[test]
    fn ties_break_on_cost_then_id() {
        // Both projects reach their cost with the same support; the cheaper wins, and the
        // deduction leaves too little for the other one.
        assert_eq!(tally(&[50, 40], &[e(50, &[1, 1])], 40), vec![1]);
        // Same support and same cost: the lower id wins.
        assert_eq!(tally(&[40, 40], &[e(40, &[1, 1])], 40), vec![0]);
    }

    #[test]
    fn abstaining_weight_only_enlarges_the_budget() {
        // 25 of voting weight cannot fund a 30 project even though the budget allows it.
        assert_eq!(tally(&[30], &[e(25, &[1])], 100), Vec::<u8>::new());
        // A None ballot behaves like abstaining weight.
        assert_eq!(tally(&[30], &[e(25, &[1]), Entry { weight: 10, ranks: None }], 0), Vec::<u8>::new());
    }

    #[test]
    fn cumulative_rounding_is_integer_exact_at_u64_scale() {
        let big = u64::MAX / 4;
        let funded = tally(&[big, big], &[e(big, &[1, 2]), e(big, &[1, 2]), e(big, &[2, 1])], 0);
        assert_eq!(funded, vec![0, 1]);
    }
}
