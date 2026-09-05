"""Commitments of the zisk variant (spec Z4 steps 2 and 5, Z5): voter chain, inputsHash,
and the ABI-encoded output whose keccak the guest commits."""

from keccak import keccak256


def w32(n):
    return int(n).to_bytes(32, "big")


def voter_chain(voters):
    h = bytes(32)
    for v in voters:
        h = keccak256(
            h
            + int(v["addr"]).to_bytes(20, "big")
            + w32(v["directWeight"])
            + w32(v["seatWeight"])
            + keccak256(bytes(v["directBallot"]))
            + keccak256(bytes(v["ciphertext"]))
        )
    return h


def costs_hash(costs):
    return keccak256(b"".join(w32(c) for c in costs))


def inputs_hash(chain_id, pool, chain, n, costs, total_weight):
    return keccak256(w32(chain_id) + int(pool).to_bytes(20, "big") + chain + w32(n) + costs_hash(costs) + w32(total_weight))


def abi_encode_output(inputs_hash_value, pk, funded):
    """abi.encode(bytes32, bytes, uint256[]) exactly as Solidity lays it out."""
    pk_tail = w32(len(pk)) + pk + bytes((-len(pk)) % 32)
    funded_tail = w32(len(funded)) + b"".join(w32(i) for i in funded)
    head = inputs_hash_value + w32(0x60) + w32(0x60 + len(pk_tail))
    return head + pk_tail + funded_tail


def output_hash(inputs_hash_value, pk, funded):
    return keccak256(abi_encode_output(inputs_hash_value, pk, funded))
