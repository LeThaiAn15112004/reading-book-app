# 017 — timing and success criteria

The manual runs of quickstart §1–§5 were done by the user on both hosts on 2026-11-22. The user reported that opening
speed is OK and that every check passed: SC-001 … SC-008, the edge cases of T057, and the before / after comparison of
T003 / T060.

The per-sample figures were not handed over, so none are recorded here. To add them, run the comparison below and paste
its `open` table (format + size only, never a title or path):

    READMATE_TIMING=1 npm run dev                                   # open the samples on commit 2a98be1, then:
    npm run spike:import:timing -- --label open-baseline
    READMATE_TIMING=1 npm run dev                                   # same samples on 017-reliable-book-opening, then:
    npm run spike:import:timing -- --label open-after --compare open-baseline
