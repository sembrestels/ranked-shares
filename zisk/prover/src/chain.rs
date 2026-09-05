//! Chain access: rebuild the witness from a pool's public reads, read its inputsHash,
//! send `finalize`.

use crate::{eyre, Result};
use alloy::primitives::{Address, Bytes, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;
use sealed::types::{TallyInput, VoterIn};

sol! {
    #[sol(rpc)]
    interface ISealedPool {
        function votersFrom(uint256 start, uint256 count) external view returns (address[] memory who, uint256[] memory direct, uint256[] memory seats, bytes[] memory ballots, bytes[] memory cts);
        function costs() external view returns (uint256[] memory);
        function totalWeight() external view returns (uint256);
        function keySalt() external view returns (bytes32);
        function inputsHash() external view returns (bytes32);
        function closed() external view returns (bool);
        function tallierPk() external view returns (bytes memory);
        function finality() external view returns (uint8);
        function fundedProjects() external view returns (uint256[] memory);
        function finalize(uint256[] calldata fundedOrder, bytes calldata publicValues, bytes calldata proofBytes) external;
    }
}

const PAGE: u64 = 200;

fn u64_of(v: U256) -> Result<u64> {
    u64::try_from(v).map_err(|_| eyre!("value {v} does not fit u64; the pool caps weights at 2^64 - 1"))
}

/// Every input the guest needs, read from the pool. The private key is derived from the
/// master secret and the pool's `keySalt`; nothing else is secret.
pub async fn fetch(rpc: &str, pool: Address, master: &[u8; 32]) -> Result<TallyInput> {
    let provider = ProviderBuilder::new().connect_http(rpc.parse()?);
    let chain_id = provider.get_chain_id().await?;
    let c = ISealedPool::new(pool, &provider);
    let salt: [u8; 32] = c.keySalt().call().await?.0;
    let costs: Vec<u64> = c.costs().call().await?.into_iter().map(u64_of).collect::<Result<_>>()?;
    let total_weight = u64_of(c.totalWeight().call().await?)?;
    let mut voters = Vec::new();
    let mut start = 0u64;
    loop {
        let page = c.votersFrom(U256::from(start), U256::from(PAGE)).call().await?;
        if page.who.is_empty() {
            break;
        }
        for i in 0..page.who.len() {
            voters.push(VoterIn {
                addr: page.who[i].into_array(),
                direct_weight: u64_of(page.direct[i])?,
                seat_weight: u64_of(page.seats[i])?,
                direct_ballot: page.ballots[i].to_vec(),
                ciphertext: page.cts[i].to_vec(),
            });
        }
        start += page.who.len() as u64;
    }
    Ok(TallyInput {
        chain_id,
        pool: pool.into_array(),
        sk: crate::keys::sk_for(master, &salt),
        costs,
        total_weight,
        voters,
    })
}

pub struct PoolState {
    pub closed: bool,
    pub inputs_hash: [u8; 32],
    pub finality: u8,
    pub tallier_pk: Vec<u8>,
}

pub async fn state(rpc: &str, pool: Address) -> Result<PoolState> {
    let provider = ProviderBuilder::new().connect_http(rpc.parse()?);
    let c = ISealedPool::new(pool, &provider);
    Ok(PoolState {
        closed: c.closed().call().await?,
        inputs_hash: c.inputsHash().call().await?.0,
        finality: c.finality().call().await?,
        tallier_pk: c.tallierPk().call().await?.to_vec(),
    })
}

/// Sends `finalize`. Returns the transaction hash; errors if the receipt is not a success.
pub async fn finalize(
    rpc: &str,
    pool: Address,
    key_hex: &str,
    funded_order: &[u8],
    public_values: &[u8],
    proof_bytes: &[u8],
) -> Result<String> {
    let signer: PrivateKeySigner = key_hex.trim().parse()?;
    let provider = ProviderBuilder::new().wallet(signer).connect_http(rpc.parse()?);
    let c = ISealedPool::new(pool, &provider);
    let order: Vec<U256> = funded_order.iter().map(|&id| U256::from(id)).collect();
    let receipt = c
        .finalize(order, Bytes::copy_from_slice(public_values), Bytes::copy_from_slice(proof_bytes))
        .send()
        .await?
        .get_receipt()
        .await?;
    if !receipt.status() {
        return Err(eyre!("finalize reverted in {}", receipt.transaction_hash));
    }
    Ok(format!("{}", receipt.transaction_hash))
}
