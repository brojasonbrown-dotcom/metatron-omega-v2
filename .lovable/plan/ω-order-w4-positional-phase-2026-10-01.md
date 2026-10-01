# Ω-UNDERSTAND W4 — word order in the field (2026-10-01)

## Information-flow review
- Source: token rank r inside one utterance (`injectTextPsi`).
- Destination: Ψ per-rung slots (what episodes, Hebbian, bitmap and Hopfield recall store);
  `LexiconMemory.readPsi` now returns each word's position; HEAR "field reads" shows them in order.
- Indicates: who-did-what — "dog chases cat" ≠ "cat chases dog" at the field level.
- Storage layering: no new store. Position 0 is unrotated, so single-word patterns and old
  single-word episodes are bit-identical; multi-word episodes captured before W4 keep their old Ψ.
- Pattern use: episodic/Hopfield recall separates role-swapped sentences; W5 prediction can score
  order; readout yields a sequence, not a bag.

## Measured problem
Role-swap Ψ cosine 0.852 (rank amplitude φ⁻ʳ is the only order signal).

## Options filtered
| Option | Verdict |
|---|---|
| amplitude-only (current) | rejected: measured 0.852 |
| shift rungs by position | rejected: breaks hashed k-of-N placement, adds collisions |
| VSA permutation/binding with position vectors | rejected: destroys template match; readout must unbind blindly |
| rotary phase (RoPE-style) in each rung's (x,y) plane by r·ω, ω = 2π/φ² golden angle | kept: norm-preserving, deterministic, position 0 unchanged, readout searches (word, position) |

## How it shows in outputs
1. Ψ role-swap cosine drops (stated test bound).
2. Readout reports positions; order accuracy on held-out sentences measured.
3. W1 precision/recall floors unchanged (no regression).
4. Episodic/Hopfield recall gets distinct keys for role-swapped sentences (measured in Ψ).

## Tests
role-swap bound; pos 0 identity; norm preservation; readout order exact on short sentences;
W1 floors; determinism; cost bounded (positions ≤ maxWords).
