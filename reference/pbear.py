"""Reference implementation of the PB Expanding Approvals Rule (PB-EAR).

Aziz & Lee, "Proportionally Representative Participatory Budgeting with Ordinal
Preferences" (AAAI-21), Algorithm 1, with the uniform fractional reweighting of
Aziz & Lee, "The expanding approvals rule" (SCW 2019).

This module mirrors the integer arithmetic of the Solidity engine exactly:

* budget L == total weight n, so a project's threshold is exactly its cost;
* a ballot is a list with one competition rank per project (0 = unranked, which
  becomes the last tier);
* among eligible projects the one with the highest support wins, then the lowest
  cost, then the lowest id;
* reweighting deducts exactly the cost from the supporters using cumulative
  rounding in voter order.

A voter whose ballot is ``None`` never supports anything; its weight, like the
``abstaining`` amount, only enlarges the budget.
"""

import json
import sys


def validate_ballot(ranks, m):
    if len(ranks) != m:
        raise ValueError("ballot length must equal the number of projects")
    counts = [0] * (m + 1)
    for r in ranks:
        if r < 0 or r > m:
            raise ValueError("rank out of range")
        counts[r] += 1
    seen = 0
    for r in range(1, m + 1):
        if counts[r] and r != seen + 1:
            raise ValueError("ranks must form a competition ranking")
        seen += counts[r]


def effective_ranks(ranks):
    default = 1 + sum(1 for r in ranks if r)
    return [r or default for r in ranks]


def cumulative_deductions(weights, thr):
    """Deduct exactly ``thr`` from ``weights`` in proportion, integer-exact."""
    total = sum(weights)
    deductions = []
    cum = 0
    for w in weights:
        new_cum = cum + w
        deductions.append(new_cum * thr // total - cum * thr // total)
        cum = new_cum
    return deductions


def pbear(costs, voters, abstaining=0):
    m = len(costs)
    weights = [w for w, _ in voters]
    ranks = []
    for _, ballot in voters:
        if ballot is None:
            ranks.append(None)
        else:
            validate_ballot(ballot, m)
            ranks.append(effective_ranks(ballot))
    budget = sum(weights) + abstaining
    funded = []
    is_funded = [False] * m
    spent = 0
    level = 1

    def exhausted():
        return all(is_funded[c] or spent + costs[c] > budget for c in range(m))

    while not exhausted():
        support = [0] * m
        for i, r in enumerate(ranks):
            if r is None or weights[i] == 0:
                continue
            for c in range(m):
                if not is_funded[c] and r[c] <= level:
                    support[c] += weights[i]
        best = None
        for c in range(m):
            if is_funded[c] or support[c] < costs[c]:
                continue
            if best is None or support[c] > support[best] or (
                support[c] == support[best] and costs[c] < costs[best]
            ):
                best = c
        if best is None:
            if level >= m:
                break
            level += 1
            continue
        supporters = [i for i, r in enumerate(ranks) if r is not None and weights[i] and r[best] <= level]
        deductions = cumulative_deductions([weights[i] for i in supporters], costs[best])
        for i, d in zip(supporters, deductions):
            weights[i] -= d
        is_funded[best] = True
        funded.append(best)
        spent += costs[best]
    return funded


def is_exhaustive(costs, budget, funded):
    spent = sum(costs[c] for c in funded)
    return all(c in funded or spent + costs[c] > budget for c in range(len(costs)))


def _subsets(items):
    n = len(items)
    for mask in range(1, 1 << n):
        yield [items[i] for i in range(n) if mask >> i & 1]


def is_ipsc(costs, budget, voters, funded):
    """Brute-force check of Inclusion PSC (Definition 5) with L == n == budget."""
    m = len(costs)
    active = [(w, effective_ranks(b)) for w, b in voters if b is not None and w]
    projects = list(range(m))
    funded_set = set(funded)
    for coalition in _subsets(active):
        b_coalition = sum(w for w, _ in coalition)
        for c_prime in _subsets(projects):
            outside = [c for c in projects if c not in c_prime]
            solid = all(
                all(r[cp] <= r[co] for cp in c_prime for co in outside) for _, r in coalition
            )
            if not solid:
                continue
            k = len(c_prime)
            periphery = {c for _, r in coalition for c in projects if r[c] <= k}
            pw = periphery & funded_set
            pw_cost = sum(costs[c] for c in pw)
            for c_star in c_prime:
                if c_star in pw:
                    continue
                if costs[c_star] + pw_cost <= b_coalition:
                    return False
    return True


def abi_encode_uint_array(values):
    words = [0x20, len(values)] + list(values)
    return "0x" + "".join(format(v, "064x") for v in words)


def main(argv):
    payload = json.loads(argv[1])
    costs = payload["costs"]
    voters = [(w, b) for w, b in payload["voters"]]
    abstaining = payload.get("abstaining", 0)
    funded = pbear(costs, voters, abstaining)
    budget = sum(w for w, _ in voters) + abstaining
    result = [
        int(is_ipsc(costs, budget, voters, funded)),
        int(is_exhaustive(costs, budget, funded)),
    ] + funded
    print(abi_encode_uint_array(result))


if __name__ == "__main__":
    main(sys.argv)
