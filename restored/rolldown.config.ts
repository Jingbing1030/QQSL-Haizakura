/**
 * SnowLuma bundler config - reproduces the ORIGINAL dist/index.mjs shape.
 *
 * The shipped artifact was produced by rolldown (not Vite/Rollup) with the
 * equivalent of `inlineDynamicImports: true`: 467 `//#region` markers covering
 * 99.68% of the file, every module inlined into one scope, ZERO `export`
 * statements, and all Node builtins hoisted to a single import prologue at the
 * top of the file.
 *
 * NOTE: this config is a faithful *reconstruction* of the original intent. The
 * restored tree feeds the build through scripts/merge.mjs, because the bundle
 * did not preserve per-module import/export edges (see RESTORE-REPORT.md S6).
 */
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'packages/core/src/index.ts',
  platform: 'node',
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: 'index.mjs',
    inlineDynamicImports: true,   // <- the single-file requirement
    minify: false,                // original binary keeps readable names
    sourcemap: false,
    // region comments are emitted by rolldown's region plugin when enabled
  },
  external: [
    /^node:/, /^(fs|path|os|util|events|net|http|https|tls|zlib|crypto|dns|stream|buffer|assert|url|worker_threads|child_process|async_hooks|module|timers|string_decoder|http2|process)(\/.*)?$/,
  ],
  // everything else (hono, otpauth, tar, fflate, zxcvbn, ...) is inlined,
  // exactly as observed in the shipped bundle.
});
