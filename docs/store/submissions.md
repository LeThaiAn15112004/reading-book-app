# Microsoft Store submissions

> Spec 010. One row per package version. `check-store-config.mjs` compares the next version with the last row whose
> **Result** says the package was actually sent to the Store (`submitted`, `certified`, `published`, `rejected`);
> rows added by `store:wack` before a submission (Result empty) do not count, so a version can be rebuilt until it is
> submitted.

| Version | Date | Package SHA-256 | WACK | Smoke | Result | Notes |
|---|---|---|---|---|---|---|
