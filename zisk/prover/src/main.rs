use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tally_prover::{chain, keys, native, Result};

#[derive(Parser)]
#[command(name = "tally-prover", about = "Prove a zisk pool's tally and finalise it on chain")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print the tallier public key for a pool salt (master secret from TALLIER_MASTER).
    Keys {
        #[arg(long)]
        salt: String,
    },
    /// Encrypt a ballot for a pool: prints the ciphertext to pass to voteSealed.
    Encrypt {
        #[arg(long)]
        pk: String,
        #[arg(long)]
        voter: String,
        /// Competition ranks, one per project, e.g. 1,2,2,0
        #[arg(long)]
        ranks: String,
    },
    /// Read a closed pool and write the guest input.
    Fetch {
        #[arg(long)]
        rpc: String,
        #[arg(long)]
        pool: String,
        #[arg(long)]
        out: PathBuf,
    },
    /// Run the guest logic natively on an input file; with --rpc/--pool, compare inputsHash with the chain.
    Check {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        rpc: Option<String>,
        #[arg(long)]
        pool: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Keys { salt } => {
            let master = keys::master_from_env()?;
            let pk = keys::pk_for(&master, &keys::parse_hex32(&salt)?)?;
            println!("0x{}", hex::encode(pk));
        }
        Cmd::Encrypt { pk, voter, ranks } => {
            let pk: [u8; 33] = hex::decode(pk.trim_start_matches("0x"))?
                .try_into()
                .map_err(|_| tally_prover::eyre!("pk must be 33 bytes"))?;
            let voter: [u8; 20] = hex::decode(voter.trim_start_matches("0x"))?
                .try_into()
                .map_err(|_| tally_prover::eyre!("voter must be 20 bytes"))?;
            let ranks: Vec<u8> =
                ranks.split(',').map(|r| r.trim().parse::<u8>()).collect::<std::result::Result<_, _>>()?;
            let ct = sealed::ballot::encrypt(&pk, &voter, &ranks, &keys::random_scalar())
                .ok_or_else(|| tally_prover::eyre!("invalid public key"))?;
            println!("0x{}", hex::encode(ct));
        }
        Cmd::Fetch { rpc, pool, out } => {
            let master = keys::master_from_env()?;
            let input = chain::fetch(&rpc, pool.parse()?, &master).await?;
            native::write_input(&out, &input)?;
            println!("wrote {} ({} voters, {} projects)", out.display(), input.voters.len(), input.costs.len());
        }
        Cmd::Check { input, rpc, pool } => {
            let report = native::check(&input)?;
            report.print();
            if let (Some(rpc), Some(pool)) = (rpc, pool) {
                let st = chain::state(&rpc, pool.parse()?).await?;
                if !st.closed {
                    return Err(tally_prover::eyre!("pool is not closed yet; run close() first"));
                }
                if st.inputs_hash != report.inputs_hash {
                    return Err(tally_prover::eyre!(
                        "inputsHash mismatch: chain 0x{} vs input 0x{}",
                        hex::encode(st.inputs_hash),
                        hex::encode(report.inputs_hash)
                    ));
                }
                if st.tallier_pk != report.pk {
                    return Err(tally_prover::eyre!(
                        "the pool's tallierPk is not the key derived from TALLIER_MASTER"
                    ));
                }
                println!("chain       inputsHash and tallierPk match");
            }
        }
    }
    Ok(())
}
