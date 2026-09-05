"""Poseidon2 over the BN254 scalar field, t = 4, as Barretenberg and Noir compute it.

Permutation: an initial external linear layer, 4 full rounds, 56 partial rounds,
4 full rounds. A full round adds the round constants to every element, applies x^5
to every element and the external matrix M4. A partial round adds the round
constant to element 0 only, applies x^5 to element 0 only and the internal matrix.

Sponge (Noir's Poseidon2Hasher and bb's poseidon2::hash, crypto/poseidon2/sponge/sponge.hpp):
state = [0, 0, 0, len << 64]; inputs fill a 3-element cache. When absorbing an
element finds the cache already full, the cache is first added into the state
and permuted (then reset and the new element starts a fresh cache) -- so an
input length that is an exact multiple of 3 fills the cache on its last element
without an intermediate permutation. After all inputs are absorbed, the
(possibly partial) cache is added into the state and one final permutation is
applied; the output is state[0].
"""

from noir.poseidon2_params import INTERNAL_DIAG, ROUND_CONSTANTS

P = 21888242871839275222246405745257275088548364400416034343698204186575808495617
T = 4
RATE = 3
ROUNDS_F = 8
ROUNDS_P = 56


def _sbox(x):
    return pow(x, 5, P)


def _external(s):
    # Poseidon2's M4, in the additions-only form of the reference implementation.
    t0 = s[0] + s[1]
    t1 = s[2] + s[3]
    t2 = 2 * s[1] + t1
    t3 = 2 * s[3] + t0
    t4 = 4 * t1 + t3
    t5 = 4 * t0 + t2
    t6 = t3 + t5
    t7 = t2 + t4
    return [t6 % P, t5 % P, t7 % P, t4 % P]


def _internal(s):
    total = sum(s) % P
    return [(s[i] * INTERNAL_DIAG[i] + total) % P for i in range(T)]


def permutation(state):
    if len(state) != T:
        raise ValueError("state must have 4 elements")
    s = _external([x % P for x in state])
    half = ROUNDS_F // 2
    for r in range(half):
        s = _external([_sbox((s[i] + ROUND_CONSTANTS[r][i]) % P) for i in range(T)])
    for r in range(half, half + ROUNDS_P):
        s[0] = _sbox((s[0] + ROUND_CONSTANTS[r][0]) % P)
        s = _internal(s)
    for r in range(half + ROUNDS_P, ROUNDS_F + ROUNDS_P):
        s = _external([_sbox((s[i] + ROUND_CONSTANTS[r][i]) % P) for i in range(T)])
    return s


def hash(inputs):
    # Matches bb's FieldSponge (crypto/poseidon2/sponge/sponge.hpp): a duplex
    # sponge whose cache only triggers a permutation when it is full *and*
    # another element still needs absorbing (not simply every RATE elements —
    # an input whose length is an exact multiple of RATE fills the cache on
    # its last element without permuting, and only the final squeeze permutes).
    inputs = [x % P for x in inputs]
    n = len(inputs)
    state = [0, 0, 0, (n << 64) % P]
    cache = [0] * RATE
    cache_size = 0
    for x in inputs:
        if cache_size == RATE:
            for j in range(RATE):
                state[j] = (state[j] + cache[j]) % P
            state = permutation(state)
            cache = [0] * RATE
            cache_size = 0
        cache[cache_size] = x
        cache_size += 1
    for j in range(RATE):
        state[j] = (state[j] + cache[j]) % P
    return permutation(state)[0]
