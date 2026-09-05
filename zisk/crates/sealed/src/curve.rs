//! secp256k1 for ECDH: `pubkey` and `shared_x`. Points are SEC1 compressed. Every
//! malformed input is `None`; nothing here panics on voter-chosen bytes (spec Z4).

/// `scalar·G`, compressed. `None` when the scalar is zero or not below the group order.
pub fn pubkey(scalar: &[u8; 32]) -> Option<[u8; 33]> {
    imp::pubkey(scalar)
}

/// The x coordinate of `scalar·point`. `None` for a bad prefix, a wrong length, `x >= p`,
/// an x with no point on the curve, a bad scalar, or a product equal to the identity.
pub fn shared_x(scalar: &[u8; 32], point: &[u8; 33]) -> Option<[u8; 32]> {
    imp::shared_x(scalar, point)
}

#[cfg(target_os = "zkvm")]
mod imp {
    use ziskos::zisklib::{lift_x_secp256k1, scalar_mul_secp256k1};

    // Little-endian u64 limbs, as zisklib represents field elements and scalars.
    const P: [u64; 4] = [0xFFFFFFFEFFFFFC2F, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF];
    const N: [u64; 4] = [0xBFD25E8CD0364141, 0xBAAEDCE6AF48A03B, 0xFFFFFFFFFFFFFFFE, 0xFFFFFFFFFFFFFFFF];
    const G: [u64; 8] = [
        0x59F2815B16F81798, 0x029BFCDB2DCE28D9, 0x55A06295CE870B07, 0x79BE667EF9DCBBAC,
        0x9C47D08FFB10D4B8, 0xFD17B448A6855419, 0x5DA4FBFC0E1108A8, 0x483ADA7726A3C465,
    ];

    fn to_limbs(b: &[u8; 32]) -> [u64; 4] {
        let mut out = [0u64; 4];
        for i in 0..4 {
            out[i] = u64::from_be_bytes(b[32 - 8 * (i + 1)..32 - 8 * i].try_into().unwrap());
        }
        out
    }

    fn from_limbs(l: &[u64]) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..4 {
            out[32 - 8 * (i + 1)..32 - 8 * i].copy_from_slice(&l[i].to_be_bytes());
        }
        out
    }

    fn lt(a: &[u64; 4], b: &[u64; 4]) -> bool {
        for i in (0..4).rev() {
            if a[i] != b[i] {
                return a[i] < b[i];
            }
        }
        false
    }

    fn scalar(s: &[u8; 32]) -> Option<[u64; 4]> {
        let k = to_limbs(s);
        (k != [0; 4] && lt(&k, &N)).then_some(k)
    }

    fn compress(p: &[u64; 8]) -> [u8; 33] {
        let mut out = [0u8; 33];
        out[0] = 2 + (p[4] & 1) as u8;
        out[1..].copy_from_slice(&from_limbs(&p[..4]));
        out
    }

    pub fn pubkey(s: &[u8; 32]) -> Option<[u8; 33]> {
        let k = scalar(s)?;
        scalar_mul_secp256k1(&k, &G).map(|p| compress(&p))
    }

    pub fn shared_x(s: &[u8; 32], point: &[u8; 33]) -> Option<[u8; 32]> {
        if point[0] != 2 && point[0] != 3 {
            return None;
        }
        let x = to_limbs(point[1..].try_into().unwrap());
        if !lt(&x, &P) {
            return None;
        }
        // zisklib's `lift_x_secp256k1` ends with `assert_eq!(parity, y_is_odd, ...)`, which
        // can only fire when `y == p - y`, i.e. `y = 0`, i.e. `x^3 + 7 = 0 (mod p)`. secp256k1
        // has odd prime order and no 2-torsion (equivalently, -7 is not a cubic residue mod
        // p), so no voter-chosen `x` reaches that assert; every other failure path returns
        // `None`. This is what keeps spec Z4's no-panic rule intact here; re-check it if the
        // zisklib dependency is ever bumped.
        let p = lift_x_secp256k1(&x, point[0] == 3).ok()?;
        let k = scalar(s)?;
        scalar_mul_secp256k1(&k, &p).map(|q| from_limbs(&q[..4]))
    }
}

#[cfg(not(target_os = "zkvm"))]
mod imp {
    use k256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
    use k256::elliptic_curve::PrimeField;
    use k256::{AffinePoint, EncodedPoint, ProjectivePoint, Scalar};

    fn scalar(s: &[u8; 32]) -> Option<Scalar> {
        let k: Option<Scalar> = Scalar::from_repr((*s).into()).into();
        k.filter(|k| *k != Scalar::ZERO)
    }

    pub fn pubkey(s: &[u8; 32]) -> Option<[u8; 33]> {
        let k = scalar(s)?;
        let ep = (ProjectivePoint::GENERATOR * k).to_affine().to_encoded_point(true);
        ep.as_bytes().try_into().ok()
    }

    pub fn shared_x(s: &[u8; 32], point: &[u8; 33]) -> Option<[u8; 32]> {
        if point[0] != 2 && point[0] != 3 {
            return None;
        }
        let ep = EncodedPoint::from_bytes(point).ok()?;
        let a: Option<AffinePoint> = AffinePoint::from_encoded_point(&ep).into();
        let k = scalar(s)?;
        let q = (ProjectivePoint::from(a?) * k).to_affine().to_encoded_point(false);
        if q.is_identity() {
            return None;
        }
        q.x().map(|x| {
            let bytes: &[u8] = x.as_ref();
            bytes.try_into().unwrap()
        })
    }
}
