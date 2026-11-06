-- Migration 030 — the scope of the last transcription job (spec 004, task T038).
--
-- `audio_transcripts.scope_json` records what the last job was asked to transcribe, as the contract's ScopeDto:
--   { "kind": "whole" } | { "kind": "track", "trackId": "..." } | { "kind": "range", "trackId"?: "...", "startMs": n, "endMs": n }
-- It is written when a job is accepted and kept when the job ends (for any reason), so that after an interruption (the app
-- quit or crashed mid-job) "Resume" can start the SAME scope again instead of the whole book. NULL = unknown (transcripts
-- made before this migration, or never started): Resume then falls back to the whole book.
--
-- Additive and nullable: nothing is rewritten, no existing row changes, the book file and every other table are untouched.

ALTER TABLE audio_transcripts ADD COLUMN scope_json TEXT CHECK (scope_json IS NULL OR json_valid(scope_json));
