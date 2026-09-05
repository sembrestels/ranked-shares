"""Ballot encoding shared by every variant.

A ballot is one competition rank per project: `1 +` the number of projects the voter
strictly prefers, `0` for unranked. This is `PBEAR._setBallot`'s rule; `validate` is the
same check on a Python list, `pack`/`unpack` the field-element form the Noir variant uses.
"""


def validate(ranks, m):
    """True iff ranks is a competition ranking over m projects (PBEAR._setBallot rules)."""
    if len(ranks) != m or any(r < 0 or r > m for r in ranks):
        return False
    counts = [0] * (m + 1)
    for r in ranks:
        counts[r] += 1
    seen = 0
    for r in range(1, m + 1):
        if counts[r] and r != seen + 1:
            return False
        seen += counts[r]
    return True


def pack(ranks):
    return sum(r << (8 * c) for c, r in enumerate(ranks))


def unpack(packed, m):
    if packed < 0 or packed >= 1 << (8 * m):
        return None
    ranks = [(packed >> (8 * c)) & 0xFF for c in range(m)]
    return ranks if validate(ranks, m) else None
