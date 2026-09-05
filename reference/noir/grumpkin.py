"""Grumpkin: y^2 = x^3 - 17 over the BN254 scalar field. Affine, infinity is None."""

P = 21888242871839275222246405745257275088548364400416034343698204186575808495617
Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583
B = P - 17
G = (1, 0x2CF135E7506A45D632D270D45F1181294833FC48D823F272C)


def _inv(a):
    return pow(a % P, P - 2, P)


def is_on_curve(pt):
    if pt is None:
        return True
    x, y = pt
    return (y * y - (x * x * x + B)) % P == 0


def add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1) * _inv(2 * y1) % P
    else:
        lam = (y2 - y1) * _inv(x2 - x1) % P
    x3 = (lam * lam - x1 - x2) % P
    y3 = (lam * (x1 - x3) - y1) % P
    return (x3, y3)


def mul(k, pt):
    k %= Q
    result = None
    acc = pt
    while k:
        if k & 1:
            result = add(result, acc)
        acc = add(acc, acc)
        k >>= 1
    return result
