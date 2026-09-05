// cre/test/master-secret.test.ts — the script derives the same master secret and
// tallier public key that `cre/src/lib` derives directly, for a fixed test key.
import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, hexToBytes } from "viem";
import fixture from "../../reference/vectors/fixture_test_main.json";
import { MASTER_MESSAGE, deriveSk } from "../src/lib/sealed";
import { pubkey } from "../src/lib/grumpkin";
import { hex } from "../src/lib/field";

// A fixed anvil test key — not a real secret, and not any key the fixture was generated
// from (the fixture doesn't carry a private key, only the resulting master/sk/pk).
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

function runScript(args: string[], env: Record<string, string>): { stdout: string; exitCode: number } {
  const { stdout, exitCode } = Bun.spawnSync(["bun", "scripts/make-master-secret.mjs", ...args], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, ...env },
  });
  return { stdout: stdout.toString(), exitCode };
}

describe("make-master-secret.mjs", () => {
  test("prints keccak256(signMessage(MASTER_MESSAGE)) with no flags", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const sig = await account.signMessage({ message: MASTER_MESSAGE });
    const expected = keccak256(sig);

    const { stdout, exitCode } = runScript([], { PRIVATE_KEY: TEST_PRIVATE_KEY });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(expected);
  });

  test("--print-pk --key-salt derives the same pk as deriveSk + pubkey", async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    const sig = await account.signMessage({ message: MASTER_MESSAGE });
    const master = hexToBytes(keccak256(sig));
    const keySalt = hexToBytes(fixture.keySalt as `0x${string}`);
    const sk = deriveSk(master, keySalt);
    const pk = pubkey(sk);

    const { stdout, exitCode } = runScript(["--print-pk", "--key-salt", fixture.keySalt], { PRIVATE_KEY: TEST_PRIVATE_KEY });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(`pkX=${hex(pk.x)}\npkY=${hex(pk.y)}`);
  });

  test("refuses to run without PRIVATE_KEY", () => {
    const env = { ...process.env };
    delete env.PRIVATE_KEY;
    const { exitCode, stdout } = Bun.spawnSync(["bun", "scripts/make-master-secret.mjs"], {
      cwd: new URL("..", import.meta.url).pathname,
      env,
    });
    expect(exitCode).not.toBe(0);
    expect(stdout.toString()).toBe("");
  });
});
