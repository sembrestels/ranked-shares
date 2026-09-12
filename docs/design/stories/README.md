# User stories

One file per story-map activity, one story per R1 task, written in Mike Cohn's format
with one Gherkin scenario each (one When, one Then). Method: `user-story` and
`user-story-splitting` skills. Source: `docs/design/story-map.md` (tasks above the R1
line), `docs/design/hypotheses.md` (the `Tests:` field), `docs/design/personas.md` (the
`As a` field). A story is the input to a spec and a plan in the build workflow; its
Then is the acceptance test.

| File | Activity | Personas |
|---|---|---|
| `01-propose-a-project.md` | 1 | Pau, Ona |
| `02-set-up-the-round.md` | 2 | Ona |
| `03-join-with-money-or-seats.md` | 3 | Dani, Sol, Ona |
| `04-rank-and-cast.md` | 4 | Dani, Sol |
| `05-follow-the-round.md` | 5 | everyone |
| `06-close-and-prove.md` | 6 | Ona, everyone |
| `07-get-paid-and-close-out.md` | 7 | Pau, Ona |

Status values: `built` (in `web/` on master with tests), `planned`. A story's status
changes to `built` in the commit that lands it. Findings from heuristic and
accessibility reviews (`docs/design/reviews/`) become new stories here.
