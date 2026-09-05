"""Circuit profiles (spec decision 7). A pool is deployed against one profile."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    name: str
    n_sealed_max: int
    m_max: int
    batch: int
    k: int


PROFILES = {
    "default": Profile("default", n_sealed_max=256, m_max=16, batch=32, k=8),
    "test": Profile("test", n_sealed_max=8, m_max=4, batch=2, k=2),
}
