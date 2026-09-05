//! Spec Z4: from the private witness to the committed output hash. Shared by the guest
//! and by `tally-prover check`.

use crate::ballot::decrypt;
use crate::commitments::{inputs_hash, output_hash, voter_chain};
use crate::curve;
use crate::types::{TallyInput, TallyOutput};
use pbear::{validate, Entry};

/// Errors caused by the operator's own input. Voter-chosen bytes never produce one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// `sk` is zero or not below the secp256k1 group order.
    InvalidKey,
    /// No projects, or more than 31.
    BadCosts,
    /// The listed entry weights exceed `total_weight`; the input does not come from `close`.
    WeightsExceedBudget,
}

pub fn run(input: &TallyInput) -> Result<TallyOutput, Error> {
    let m = input.costs.len();
    if m == 0 || m > 31 {
        return Err(Error::BadCosts);
    }
    let pk = curve::pubkey(&input.sk).ok_or(Error::InvalidKey)?;

    let chain = voter_chain(&input.voters);
    let ih = inputs_hash(input.chain_id, &input.pool, &chain, input.voters.len() as u64, &input.costs, input.total_weight);

    let mut entries: Vec<Entry> = Vec::new();
    let mut voting: u128 = 0;
    // Public block: every voter with a direct ballot, registration order.
    for v in &input.voters {
        if !v.direct_ballot.is_empty() && validate(&v.direct_ballot, m) {
            entries.push(Entry { weight: v.direct_weight, ranks: Some(v.direct_ballot.clone()) });
            voting += v.direct_weight as u128;
        }
    }
    // Sealed block: every voter whose ciphertext decrypts, registration order.
    for v in &input.voters {
        if v.ciphertext.is_empty() {
            continue;
        }
        if let Some(ranks) = decrypt(&input.sk, &v.addr, &v.ciphertext, m) {
            entries.push(Entry { weight: v.seat_weight, ranks: Some(ranks) });
            voting += v.seat_weight as u128;
        }
    }
    let abstaining = (input.total_weight as u128).checked_sub(voting).ok_or(Error::WeightsExceedBudget)? as u64;

    let funded_order = pbear::tally(&input.costs, &entries, abstaining);
    let oh = output_hash(&ih, &pk, &funded_order);
    Ok(TallyOutput { inputs_hash: ih, pk, funded_order, output_hash: oh })
}
