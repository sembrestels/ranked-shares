//! Random instances tallied by `pbear::tally` and by `reference/pbear.py`, which is the
//! oracle the Foundry differential fuzz already uses. Needs `python3` on the PATH.

use pbear::{tally, Entry};
use std::path::PathBuf;
use std::process::Command;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// A random competition ranking with ties: score each project 0..=3, 0 = unranked.
fn random_ranks(rng: &mut Rng, m: usize) -> Vec<u8> {
    let scores: Vec<u64> = (0..m).map(|_| rng.below(4)).collect();
    scores
        .iter()
        .map(|&s| if s == 0 { 0 } else { 1 + scores.iter().filter(|&&t| t != 0 && t > s).count() as u8 })
        .collect()
}

fn reference_py() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../reference/pbear.py")
}

fn oracle(costs: &[u64], entries: &[Entry], abstaining: u64) -> Vec<u8> {
    let voters: Vec<String> = entries
        .iter()
        .map(|e| match &e.ranks {
            Some(r) => format!("[{}, {:?}]", e.weight, r),
            None => format!("[{}, null]", e.weight),
        })
        .collect();
    let payload = format!(
        "{{\"costs\": {:?}, \"voters\": [{}], \"abstaining\": {}}}",
        costs,
        voters.join(", "),
        abstaining
    );
    let out = Command::new("python3").arg(reference_py()).arg(&payload).output().expect("python3 runs");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let hex = String::from_utf8(out.stdout).unwrap();
    let hex = hex.trim().trim_start_matches("0x");
    let words: Vec<u64> = (0..hex.len() / 64)
        .map(|i| u64::from_str_radix(&hex[i * 64 + 48..i * 64 + 64], 16).unwrap())
        .collect();
    // words: [0x20, len, ipsc, exhaustive, funded...]
    words[4..].iter().map(|&w| w as u8).collect()
}

#[test]
fn matches_python_reference_on_random_instances() {
    let mut rng = Rng(0x5EED_5EED_5EED_5EED);
    for round in 0..150 {
        let m = 1 + rng.below(5) as usize;
        let huge = round % 5 == 4; // exercise the u128 path
        let scale: u64 = if huge { 1 << 58 } else { 1 };
        let costs: Vec<u64> = (0..m).map(|_| (1 + rng.below(60)) * scale).collect();
        let n = rng.below(9) as usize;
        // Keep huge rounds within the u64 budget bound (weights, costs and the total
        // budget all fit u64): with up to 8 entries, sum of weights + abstaining <= 32 *
        // 2^58 = 2^63.
        let weight_bound: u64 = if huge { 4 } else { 50 };
        let abstaining_bound: u64 = if huge { 8 } else { 40 };
        let entries: Vec<Entry> = (0..n)
            .map(|_| Entry {
                weight: rng.below(weight_bound) * scale,
                ranks: if rng.below(8) == 0 { None } else { Some(random_ranks(&mut rng, m)) },
            })
            .collect();
        let abstaining = rng.below(abstaining_bound) * scale;
        assert_eq!(tally(&costs, &entries, abstaining), oracle(&costs, &entries, abstaining), "round {round}: costs {costs:?} entries {entries:?} abstaining {abstaining}");
    }
}
