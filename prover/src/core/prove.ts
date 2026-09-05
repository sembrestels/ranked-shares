// prover/src/core/prove.ts — bb.js UltraHonk proving and verification
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir, type CompiledCircuit, type InputMap } from "@noir-lang/noir_js";
import { circuit } from "./artifacts";

export type Kind = "ingest" | "tally";
export type ProofOut = { proof: Uint8Array; publicInputs: `0x${string}`[] };

export class Prover {
  private constructor(
    private api: Barretenberg,
    private noirs: Record<Kind, Noir>,
    private backends: Record<Kind, UltraHonkBackend>,
  ) {}

  static async create(profile: "test" | "default", threads = 1): Promise<Prover> {
    const api = await Barretenberg.new({ threads });
    const circuits: Record<Kind, CompiledCircuit> = { ingest: circuit("ingest", profile), tally: circuit("tally", profile) };
    const noirs = { ingest: new Noir(circuits.ingest), tally: new Noir(circuits.tally) };
    const backends = { ingest: new UltraHonkBackend(circuits.ingest.bytecode, api), tally: new UltraHonkBackend(circuits.tally.bytecode, api) };
    return new Prover(api, noirs, backends);
  }

  async prove(kind: Kind, inputs: InputMap): Promise<ProofOut> {
    const { witness } = await this.noirs[kind].execute(inputs);
    const { proof, publicInputs } = await this.backends[kind].generateProof(witness, { verifierTarget: "evm" });
    return { proof, publicInputs: publicInputs.map((p) => (p.startsWith("0x") ? p : `0x${p}`) as `0x${string}`) };
  }

  async verify(kind: Kind, out: ProofOut): Promise<boolean> {
    return this.backends[kind].verifyProof({ proof: out.proof, publicInputs: out.publicInputs }, { verifierTarget: "evm" });
  }

  async destroy() {
    await this.api.destroy();
  }
}
