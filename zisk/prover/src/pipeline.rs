//! The proving pipeline as processes: `cargo-zisk prove`, `cargo-zisk wrap`,
//! `cargo-zisk-dev export-solidity-calldata`, with the environment this machine needs.
//! Prove and wrap are separate processes on purpose: together they exhaust a 30 GB box.

use crate::{eyre, native, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Tools {
    pub cargo_zisk: PathBuf,
    pub cargo_zisk_dev: PathBuf,
    pub proving_key: PathBuf,
    pub proving_key_snark: PathBuf,
    pub guest_elf: PathBuf,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/root".into()))
}

fn env_path(name: &str, default: PathBuf) -> PathBuf {
    std::env::var_os(name).map(PathBuf::from).unwrap_or(default)
}

impl Tools {
    pub fn from_env() -> Self {
        let zisk = home().join(".zisk");
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        Tools {
            cargo_zisk: env_path("CARGO_ZISK", zisk.join("bin/cargo-zisk")),
            cargo_zisk_dev: env_path("CARGO_ZISK_DEV", zisk.join("bin/cargo-zisk-dev")),
            proving_key: env_path("ZISK_PROVING_KEY", zisk.join("provingKey")),
            proving_key_snark: env_path("ZISK_PROVING_KEY_SNARK", zisk.join("provingKeySnark")),
            guest_elf: env_path(
                "TALLY_GUEST_ELF",
                workspace.join("target/elf/riscv64ima-zisk-zkvm-elf/release/tally-guest"),
            ),
        }
    }
}

fn run(cmd: &mut Command, what: &str) -> Result<()> {
    cmd.env("HWLOC_COMPONENTS", "-gl").env("GLIBC_TUNABLES", "glibc.rtld.execstack=2");
    eprintln!("$ {cmd:?}");
    let status = cmd.status().map_err(|e| eyre!("cannot start {what}: {e}"))?;
    if !status.success() {
        return Err(eyre!("{what} failed with {status}"));
    }
    Ok(())
}

pub fn prove(t: &Tools, input: &Path, out: &Path) -> Result<()> {
    if !t.guest_elf.exists() {
        return Err(eyre!("guest ELF not found at {}; build it with cargo-zisk", t.guest_elf.display()));
    }
    run(
        Command::new(&t.cargo_zisk)
            .args(["prove", "-e"])
            .arg(&t.guest_elf)
            .arg("-i")
            .arg(input)
            .arg("-k")
            .arg(&t.proving_key)
            .arg("-o")
            .arg(out)
            .arg("-y"),
        "cargo-zisk prove",
    )
}

pub fn wrap(t: &Tools, stark: &Path, out: &Path) -> Result<()> {
    run(
        Command::new(&t.cargo_zisk)
            .args(["wrap", "-p"])
            .arg(stark)
            .arg("-k")
            .arg(&t.proving_key)
            .arg("-w")
            .arg(&t.proving_key_snark)
            .arg("--plonk")
            .arg("-o")
            .arg(out),
        "cargo-zisk wrap",
    )
}

/// The four fields the verifier takes plus what `submit` needs. Loads the exporter's
/// own file (four fields) as well as ours.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Calldata {
    #[serde(rename = "programVK")]
    pub program_vk: String,
    #[serde(rename = "rootCVadcopFinal")]
    pub root_c_vadcop_final: String,
    #[serde(rename = "publicValues")]
    pub public_values: String,
    #[serde(rename = "proofBytes")]
    pub proof_bytes: String,
    #[serde(rename = "fundedOrder", default)]
    pub funded_order: Vec<u8>,
    #[serde(rename = "inputsHash", default)]
    pub inputs_hash: String,
    #[serde(rename = "outputHash", default)]
    pub output_hash: String,
}

pub fn load_calldata(path: &Path) -> Result<Calldata> {
    Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
}

/// ZisK's on-chain form of 32 committed bytes (spec Z5 step 2).
pub fn expected_public_values(hash: &[u8; 32]) -> Vec<u8> {
    let mut pv = vec![0u8; 512];
    for i in 0..8 {
        pv[8 * i..8 * i + 4].copy_from_slice(&hash[4 * i..4 * i + 4]);
    }
    pv
}

/// Exports the calldata of a wrapped proof and adds the native run's result, refusing
/// to write a file whose public values do not encode that result.
pub fn export(t: &Tools, plonk: &Path, input: &Path, out: &Path) -> Result<Calldata> {
    let tmp = out.with_extension("exporter.json");
    run(
        Command::new(&t.cargo_zisk_dev).args(["export-solidity-calldata", "-p"]).arg(plonk).arg("-o").arg(&tmp),
        "cargo-zisk-dev export-solidity-calldata",
    )?;
    let mut cd = load_calldata(&tmp)?;
    std::fs::remove_file(&tmp).ok();
    let report = native::check(input)?;
    let pv = hex::decode(cd.public_values.trim_start_matches("0x"))?;
    if pv != expected_public_values(&report.output_hash) {
        return Err(eyre!("the proof's public values do not encode this input's output hash"));
    }
    if cd.root_c_vadcop_final == cd.program_vk {
        return Err(eyre!("rootCVadcopFinal equals programVK: cargo-zisk lacks the fix of ZisK PR #1299"));
    }
    cd.funded_order = report.funded_order;
    cd.inputs_hash = format!("0x{}", hex::encode(report.inputs_hash));
    cd.output_hash = format!("0x{}", hex::encode(report.output_hash));
    std::fs::write(out, serde_json::to_string_pretty(&cd)? + "\n")?;
    Ok(cd)
}
