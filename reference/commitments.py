"""Commitments of spec B6.1, B6.3 and the circuit state of B7, in Python."""

from dataclasses import dataclass

import poseidon2
from keccak import keccak256
from pbear import NONE, cumulative_deductions, effective_ranks
from sealed import unpack


class TranscriptMismatch(Exception):
    """A transcript step the tally circuit would refuse to absorb."""


def _w32(n):
    return int(n).to_bytes(32, "big")


def sealed_chain(entries, batch):
    """The Poseidon2 chain of spec B6.1 with a checkpoint every `batch` entries.

    `checkpoints[0]` is zero and the list always holds `1 + max(1, ceil(n / batch))`
    entries, one per batch of `numBatches`. An empty sealed block is therefore
    `(0, [0, 0])`: one batch whose `hIn` and `hOut` are both zero, which is exactly
    what an ingest proof over an empty batch produces.
    """
    h, checkpoints = 0, [0]
    n = len(entries)
    for j, (addr, seat_weight, rx, ry, c) in enumerate(entries):
        h = poseidon2.hash([h, addr, seat_weight, rx, ry, c])
        if (j + 1) % batch == 0 or j + 1 == n:
            checkpoints.append(h)
    if n == 0:
        checkpoints.append(0)
    return h, checkpoints


def public_chain(entries):
    h = b"\x00" * 32
    for addr, direct_weight, packed in entries:
        h = keccak256(h + int(addr).to_bytes(20, "big") + _w32(direct_weight) + _w32(packed))
    return h


def costs_hash(costs):
    return poseidon2.hash(list(costs))


def inputs_root(h_pub, h_sealed, sealed_count, costs_hash_value, total_weight):
    return keccak256(h_pub + _w32(h_sealed) + _w32(sealed_count) + _w32(costs_hash_value) + _w32(total_weight))


def transcript_hash_after(t_hash, step):
    return poseidon2.hash([t_hash] + list(step))


def transcript_hash(transcript):
    h = 0
    for step in transcript:
        h = transcript_hash_after(h, step)
    return h


@dataclass
class State:
    weights: list
    ballots: list
    funded: list
    funded_order: list
    funded_count: int
    level: int
    spent: int
    done: bool
    m: int
    budget: int
    t_hash: int = 0


def empty_state(profile, m, budget):
    return State(
        weights=[0] * profile.n_sealed_max,
        ballots=[0] * profile.n_sealed_max,
        funded=[False] * profile.m_max,
        funded_order=[0] * profile.m_max,
        funded_count=0,
        level=1,
        spent=0,
        done=False,
        m=m,
        budget=budget,
    )


def funded_bits(state):
    return sum(1 << c for c, f in enumerate(state.funded) if f)


def funded_order_packed(state):
    return sum(state.funded_order[j] << (8 * j) for j in range(state.funded_count))


def state_commit(profile, state):
    assert len(state.weights) == profile.n_sealed_max and len(state.funded) == profile.m_max
    flat = (
        list(state.weights)
        + list(state.ballots)
        + [funded_bits(state), funded_order_packed(state), state.funded_count, state.level,
           state.spent, int(state.done), state.m, state.budget, state.t_hash]
    )
    return poseidon2.hash(flat)


def ingest(state, index, seat_weight, packed):
    """Entry `index` of the sealed block: weight and ballot, or zeros when absent."""
    if packed is None:
        state.weights[index], state.ballots[index] = 0, 0
    else:
        state.weights[index], state.ballots[index] = seat_weight, packed


def _exhausted(state, costs):
    return all(state.funded[c] or state.spent + costs[c] > state.budget for c in range(state.m))


def _entry_ranks(state, e):
    ranks = unpack(state.ballots[e], state.m)
    return None if ranks is None else effective_ranks(ranks)


def tally_step(profile, state, costs, step):
    """One step of the `tally` circuit (spec B7), driven by a transcript step.

    `profile` is accepted for API symmetry with `state_commit`, which needs it to check
    the array lengths; this function reads only `state`, so it is not read here.
    """
    m = state.m
    if state.done:
        return
    if _exhausted(state, costs):
        state.done = True
        return
    if len(step) != m + 3:
        raise TranscriptMismatch("step length")
    level, pub, best, total = step[0], list(step[1 : m + 1]), step[m + 1], step[m + 2]
    if level != state.level:
        raise TranscriptMismatch("level")
    state.t_hash = transcript_hash_after(state.t_hash, step)
    sealed = [0] * m
    ranks = [(_entry_ranks(state, e) if state.weights[e] else None) for e in range(len(state.weights))]
    for e, r in enumerate(ranks):
        if r is None:
            continue
        for c in range(m):
            if not state.funded[c] and r[c] <= level:
                sealed[c] += state.weights[e]
    total_support = [pub[c] + sealed[c] for c in range(m)]
    argmax = None
    for c in range(m):
        if state.funded[c] or total_support[c] < costs[c]:
            continue
        if argmax is None or total_support[c] > total_support[argmax] or (
            total_support[c] == total_support[argmax] and costs[c] < costs[argmax]
        ):
            argmax = c
    if best != (NONE if argmax is None else argmax):
        raise TranscriptMismatch("best")
    if best == NONE:
        if total != 0:
            raise TranscriptMismatch("total")
        if level >= m:
            state.done = True
        else:
            state.level += 1
        return
    if total != total_support[best]:
        raise TranscriptMismatch("total")
    # The public block came first, so the sealed block's cumulative rounding starts at
    # `pub[best]` and divides by the transcript's `total`.
    supporters = [e for e, r in enumerate(ranks) if r is not None and r[best] <= level]
    for e, d in zip(supporters, cumulative_deductions(
        [state.weights[e] for e in supporters], costs[best], total, pub[best]
    )):
        state.weights[e] -= d
    state.funded[best] = True
    state.funded_order[state.funded_count] = best
    state.funded_count += 1
    state.spent += costs[best]
    if _exhausted(state, costs):
        state.done = True
