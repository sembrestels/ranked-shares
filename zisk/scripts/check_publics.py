#!/usr/bin/env python3
"""check_publics.py <calldata.json> <outputHash hex>

Asserts that the exported `publicValues` are exactly what a guest committing those 32
bytes produces (spec Z5 step 2): 512 bytes, slot i (8 bytes) = hash[4i:4i+4] + 4 zero
bytes for i < 8, all zero beyond. Prints programVK and rootCVadcopFinal for plan B.
"""
import json
import sys

calldata, expected = sys.argv[1], sys.argv[2]
d = json.load(open(calldata))
pv = bytes.fromhex(d["publicValues"][2:])
h = bytes.fromhex(expected.removeprefix("0x"))
assert len(h) == 32
want = b"".join(h[4 * i : 4 * i + 4] + bytes(4) for i in range(8)) + bytes(512 - 64)
assert len(pv) == 512, f"publicValues is {len(pv)} bytes, expected 512"
assert pv == want, "publicValues do not match the expected layout:\n got  %s\n want %s" % (pv.hex(), want.hex())
assert d["rootCVadcopFinal"] != d["programVK"], "rootC equals programVK: the wrap bug of ZisK PR #1299 is present in this cargo-zisk"
print("publicValues layout OK")
print("programVK        ", d["programVK"])
print("rootCVadcopFinal ", d["rootCVadcopFinal"])
print("proofBytes       ", len(bytes.fromhex(d["proofBytes"][2:])), "bytes")
