use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tally_prover::{chain, keys, native, pipeline, Result};

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
    /// STARK-prove an input file with the guest (about 16 minutes and 26 GB on the reference machine).
    Prove {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Wrap a STARK proof into a PLONK proof (about 11 minutes).
    Wrap {
        #[arg(long)]
        proof: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Export the Solidity calldata of a PLONK proof, with the funded order of the input.
    Export {
        #[arg(long)]
        proof: PathBuf,
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },
    /// Send finalize() with a calldata file. The signing key is read from the named env var.
    Submit {
        #[arg(long)]
        rpc: String,
        #[arg(long)]
        pool: String,
        #[arg(long)]
        calldata: PathBuf,
        #[arg(long, default_value = "SUBMITTER_KEY")]
        key_env: String,
        /// Needed when the calldata file has no fundedOrder (the exporter's raw file).
        #[arg(long)]
        input: Option<PathBuf>,
    },
    /// fetch, check, prove, wrap, export, submit in one go inside --workdir.
    Run {
        #[arg(long)]
        rpc: String,
        #[arg(long)]
        pool: String,
        #[arg(long)]
        workdir: PathBuf,
        #[arg(long, default_value = "SUBMITTER_KEY")]
        key_env: String,
        /// Reuse <workdir>/calldata.json instead of proving.
        #[arg(long)]
        skip_prove: bool,
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
        Cmd::Prove { input, out } => pipeline::prove(&pipeline::Tools::from_env(), &input, &out)?,
        Cmd::Wrap { proof, out } => pipeline::wrap(&pipeline::Tools::from_env(), &proof, &out)?,
        Cmd::Export { proof, input, out } => {
            let cd = pipeline::export(&pipeline::Tools::from_env(), &proof, &input, &out)?;
            println!("wrote {} (fundedOrder {:?}, programVK {})", out.display(), cd.funded_order, cd.program_vk);
        }
        Cmd::Submit { rpc, pool, calldata, key_env, input } => {
            let mut cd = pipeline::load_calldata(&calldata)?;
            if cd.funded_order.is_empty() {
                let input = input.ok_or_else(|| tally_prover::eyre!("calldata has no fundedOrder; pass --input"))?;
                cd.funded_order = native::check(&input)?.funded_order;
            }
            let key = std::env::var(&key_env).map_err(|_| tally_prover::eyre!("{key_env} is not set"))?;
            let tx = chain::finalize(
                &rpc,
                pool.parse()?,
                &key,
                &cd.funded_order,
                &hex::decode(cd.public_values.trim_start_matches("0x"))?,
                &hex::decode(cd.proof_bytes.trim_start_matches("0x"))?,
            )
            .await?;
            println!("finalized in {tx}");
        }
        Cmd::Run { rpc, pool, workdir, key_env, skip_prove } => {
            std::fs::create_dir_all(&workdir)?;
            let tools = pipeline::Tools::from_env();
            let master = keys::master_from_env()?;
            let pool_addr = pool.parse()?;
            let input = workdir.join("input.bin");
            native::write_input(&input, &chain::fetch(&rpc, pool_addr, &master).await?)?;
            let report = native::check(&input)?;
            report.print();
            let st = chain::state(&rpc, pool_addr).await?;
            if !st.closed || st.inputs_hash != report.inputs_hash {
                return Err(tally_prover::eyre!("pool not closed or inputsHash mismatch; refusing to prove"));
            }
            let calldata = workdir.join("calldata.json");
            if !(skip_prove && calldata.exists()) {
                let stark = workdir.join("stark.bin");
                let plonk = workdir.join("plonk.bin");
                pipeline::prove(&tools, &input, &stark)?;
                pipeline::wrap(&tools, &stark, &plonk)?;
                pipeline::export(&tools, &plonk, &input, &calldata)?;
            }
            let cd = pipeline::load_calldata(&calldata)?;
            let pv = hex::decode(cd.public_values.trim_start_matches("0x"))?;
            if pv != pipeline::expected_public_values(&report.output_hash) {
                return Err(tally_prover::eyre!("{} does not belong to this pool's input", calldata.display()));
            }
            let key = std::env::var(&key_env).map_err(|_| tally_prover::eyre!("{key_env} is not set"))?;
            let order = if cd.funded_order.is_empty() { report.funded_order.clone() } else { cd.funded_order.clone() };
            let tx = chain::finalize(&rpc, pool_addr, &key, &order, &pv, &hex::decode(cd.proof_bytes.trim_start_matches("0x"))?).await?;
            println!("finalized in {tx}");
        }
    }
    Ok(())
}
