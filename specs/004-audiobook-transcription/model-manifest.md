# Model & binary manifest (pinned versions + SHA-256)

**Status: B1 (speech models) VERIFIED for the files listed below (2026-10-27). B2 (FFmpeg artifacts) and B3 (licence/packaging) are NOT done — nothing FFmpeg-related is verified (see below and research.md R2).**

## Speech models (B1) — source: Hugging Face, library `@huggingface/transformers` 4.3.0

Verified on 2026-10-27. Nothing here is integrated into the app: models are downloaded only after the user consents (T013/T020), never bundled.

**Pinned runtime configuration (to be exercised by T014/T014a, not yet run):** the Whisper `automatic-speech-recognition` pipeline with `dtype: 'q8'`, which makes transformers.js request the `_quantized` ONNX files. Only this variant is in the manifest. Accuracy/speed of `q8` is NOT validated yet (T014a smoke test, T036 WER); if it is unsuitable, another variant (e.g. fp32) needs its own verified entries — it must not be added from memory.

**How each entry was verified**
- Revision: the full 40-hex commit id, confirmed through the Hub API (`/api/models/<repo>/revision/<sha>` returned the same id). Downloads use `https://huggingface.co/<repo>/resolve/<revision>/<path>` — never `main`.
- SHA-256: computed locally on the bytes downloaded from that URL (size also matched the Hub's reported size).
- Cross-check: for the two ONNX files (stored in LFS) the locally computed SHA-256 equals the SHA-256 (`lfs.oid`) the Hub reports for that file at that revision. For the five JSON files (not in LFS; the Hub offers no SHA-256) the locally computed git blob SHA-1 equals the blob id the Hub reports in the revision's tree. The SHA-256 of those JSON files comes from our own download only.
- Trust root: the Hugging Face host and the pinned commit. There is no publisher signature to check; the manifest protects against corruption, tampering in transit or later changes of the repo, not against a malicious commit that was already there on 2026-10-27.
- Licence evidence: the `onnx-community/*` repos declare no licence of their own; their `base_model` is `openai/whisper-<size>`, whose Hub metadata lists `license:apache-2.0` for tiny, base and small. This is metadata evidence only and is NOT a legal review (attribution/notice obligations still to be decided with the owner).

**Files the runtime requests (observed with transformers.js 4.3.0, `dtype: 'q8'`, ONNX requests stubbed so that nothing was loaded or run):** `config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx`, `generation_config.json` — the same seven for all three models. Other files in the repos (`vocab.json`, `merges.txt`, `added_tokens.json`, `normalizer.json`, `special_tokens_map.json`, other dtype variants, `*_data`) were not requested and are not needed; the repos contain no external-data (`.onnx_data`) files.

**Limits of that evidence:** the request log stops at the (stubbed) ONNX files, so anything transformers.js would only request AFTER a successful model load is not observed yet. T014a must therefore load and run from the local verified folder with remote access disabled (`allowRemoteModels = false`): any file missing from this manifest then fails loudly instead of being fetched. Also observed: `pipeline()` first fetches `config.json`, `tokenizer_config.json` and `preprocessor_config.json` from the `main` revision even when a `revision` is passed. The app therefore must NOT call `pipeline()` against the Hub; T013 downloads the pinned files itself, verifies them, and the worker loads from the local folder only.

### whisper-tiny — `onnx-community/whisper-tiny` @ `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`

Hub `lastModified` of that revision: 2025-06-19T13:56:43.000Z; gated: False. Total 43,613,734 bytes (43.6 MB).

| File | Bytes | SHA-256 (computed locally) | Hub cross-check |
|---|---:|---|---|
| `config.json` | 2,243 | `46aeea0a406afbeb563fc8e59ca10609203df4299af6a83f73752fef369efd2d` | git blob SHA-1 equal (4497848d6f63…) |
| `generation_config.json` | 3,772 | `f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1` | git blob SHA-1 equal (3f732b9ea02e…) |
| `preprocessor_config.json` | 339 | `a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d` | git blob SHA-1 equal (91876762a536…) |
| `tokenizer.json` | 2,480,466 | `27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566` | git blob SHA-1 equal (1e95340ff836…) |
| `tokenizer_config.json` | 282,683 | `2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce` | git blob SHA-1 equal (d13b786c0476…) |
| `onnx/encoder_model_quantized.onnx` | 10,124,990 | `2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19` | LFS SHA-256 equal |
| `onnx/decoder_model_merged_quantized.onnx` | 30,719,241 | `25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3` | LFS SHA-256 equal |

### whisper-base — `onnx-community/whisper-base` @ `1846881b6b3a3024392c1eea3ad983695bc23925`

Hub `lastModified` of that revision: 2025-06-19T13:49:48.000Z; gated: False. Total 79,664,191 bytes (79.7 MB).

| File | Bytes | SHA-256 (computed locally) | Hub cross-check |
|---|---:|---|---|
| `config.json` | 2,243 | `f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b` | git blob SHA-1 equal (ce7faf5d5e56…) |
| `generation_config.json` | 3,832 | `61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0` | git blob SHA-1 equal (a57cdbf03697…) |
| `preprocessor_config.json` | 339 | `a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d` | git blob SHA-1 equal (91876762a536…) |
| `tokenizer.json` | 2,480,466 | `27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566` | git blob SHA-1 equal (1e95340ff836…) |
| `tokenizer_config.json` | 282,682 | `2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573` | git blob SHA-1 equal (25be523be5ac…) |
| `onnx/encoder_model_quantized.onnx` | 23,201,314 | `5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46` | LFS SHA-256 equal |
| `onnx/decoder_model_merged_quantized.onnx` | 53,693,315 | `fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b` | LFS SHA-256 equal |

### whisper-small — `onnx-community/whisper-small` @ `36050c46d777d46dc4b5f43f6d90574fc38f8732`

Hub `lastModified` of that revision: 2025-06-19T13:56:48.000Z; gated: False. Total 251,846,613 bytes (251.8 MB).

| File | Bytes | SHA-256 (computed locally) | Hub cross-check |
|---|---:|---|---|
| `config.json` | 2,227 | `457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18` | git blob SHA-1 equal (b0447377b1ad…) |
| `generation_config.json` | 3,893 | `f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0` | git blob SHA-1 equal (703dc78ee83e…) |
| `preprocessor_config.json` | 339 | `a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d` | git blob SHA-1 equal (91876762a536…) |
| `tokenizer.json` | 2,480,466 | `27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566` | git blob SHA-1 equal (1e95340ff836…) |
| `tokenizer_config.json` | 282,683 | `2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce` | git blob SHA-1 equal (d13b786c0476…) |
| `onnx/encoder_model_quantized.onnx` | 92,326,160 | `a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92` | LFS SHA-256 equal |
| `onnx/decoder_model_merged_quantized.onnx` | 156,750,845 | `ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9` | LFS SHA-256 equal |

Live check (2026-10-27): `whisper-tiny` was downloaded through `model-manager.ts` using this catalog and every file passed the size + SHA-256 gate; `whisper-base` and `whisper-small` have not been downloaded through the manager yet.

Failure behaviour on mismatch (implemented in T013): delete partial files, install nothing, never load, `INTEGRITY_FAILED`.

Not verified: any model other than `whisper-tiny`/`base`/`small` at these revisions, any dtype other than `q8`, behaviour of the files at run time (T014a).

## Decoder binaries (B2) — own minimal LGPL FFmpeg build

**Status: win32-x64 built and tested (2026-10-28); macOS not built. Values come only from actual builds (T001a).** Decision basis: research.md R2/B3. `ffmpeg-static@5.3.0` is rejected (GPL binaries).

| Artifact | Binary / library files and SHA-256 | FFmpeg source (tag, commit, tarball SHA-256) | Configure line | Toolchain | Status |
|---|---|---|---|---|---|
| win32-x64 | `ffmpeg.exe` (static, single file) SHA-256 `be96e0c4e044fab7b0a5c20b3c7286d88f33a2fcb09b92d5f8a3fedff5f6829c` | 9.0.2 release tarball, SHA-256 `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e` | see ffmpeg-build-record.md §1 | MSYS2 UCRT64 gcc 16.2.0, NASM 3.02 | built + decode-tested 2026-10-28; T001b legal NOT done |
| darwin-arm64 | NOT BUILT | NOT RECORDED | NOT RECORDED | NOT RECORDED | blocked |
| darwin-x64 | NOT BUILT (separate from darwin-arm64; no universal binary — owner decision 2026-10-27) | NOT RECORDED | NOT RECORDED | NOT RECORDED | blocked |

Verification evidence (`-L`, `-buildconf`, linked-library inventory, decode results per format, licence audit, shipped notices, legal sign-off) lives in `ffmpeg-build-record.md` and is also NOT STARTED.
