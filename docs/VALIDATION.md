# Verification record

Local verification on 25 October 2026, macOS arm64, Node 24.14.0, stable Rust, Chromium 156 through Playwright. Browser rendering used software WebGL2 (SwiftShader) for reproducibility. Hardware/browser/OS differences affect timings.

## Passing checks

| Check                                           | Result                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production Rust/Wasm + TypeScript + Vite build  | Passed; Wasm module about 39 KB, app JS about 283 KB before gzip                                                                                  |
| Rust tests                                      | 4 passed: signed sample/endian decoding, exact polygon/swap, waveform gate/brush/renumber, 9-million-label count integrity                        |
| TypeScript unit tests                           | 5 passed: header/binary boundary, incremental file grouping, cut/CLu validation, sparse/dense undo identity, occupancy and autocorrelation sanity |
| Chromium browser tests                          | 5 passed, including two optional local data tests                                                                                                 |
| Dependency audit after updating the test runner | Zero reported vulnerabilities                                                                                                                     |
| Git diff whitespace check                       | Passed                                                                                                                                            |

Browser scenarios:

1. Import the supplied private sample directory, organise three trials with 16 tetrodes each, switch among recordings, create a lasso cut, and undo it. The supplied data contains no cut files. No sample bytes are checked into the repository or sent to a server.
2. Import a generated **9,000,000-spike** tetrode and **100 cells plus noise**, merge, undo, export, reparse the export, and compare a hash of **every label** with the original synthetic assignment vector.
3. Synthetic demo: merge, waveform split, undo/redo, switch away and back, waveform overview, settings, direction view, pinned comparison, cut duplication and cut export.
4. Serve the production build from an actual `/waveform/` static mount and load the demo, worker and Wasm module successfully.
5. Verify the 390-pixel mobile welcome screen fits the viewport.

## Timings observed

| Workload                                    | Observed time | What is included                                                                                                                                                      |
| ------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9M synthetic records, Wasm benchmark        | 1.16–1.25 s   | Chunk generation/timestamp writes, copying chunks into Wasm, signed-wave amplitude extraction and timestamp decoding                                                  |
| Merge about 89K members of one of 100 cells | 14.9–15.3 ms  | Rust relabel + population recount; excludes patch persistence and UI                                                                                                  |
| Wasm memory after 9M decode                 | 93.81 MiB     | Includes full population arrays, allocator overhead and scratch allocation high-water mark; excludes JS/GPU/browser memory                                            |
| 9M fixture, browser first load              | 3.58–4.35 s   | File picker automation, cut parsing, chunked file reads, Rust decoding, reservoir creation, population summary, bounded view transfer and initial React/GPU rendering |
| Real sample tetrode, 704,080 spikes         | 125 ms        | Node/Wasm chunked decoder benchmark, including local file reads                                                                                                       |

These timings do not establish a universal frame-rate or memory ceiling. The browser first-load measurement ends when Export cut becomes enabled; selected-cell analysis can finish afterwards. Warm operating-system file caches may improve local IO timings. The two large fixtures are optional in CI so contributors do not need to download private data or generate 2 GB for routine checks.

## Reproduce

```sh
npm ci
rustup target add wasm32-unknown-unknown
npm run test:rust
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run bench

node scripts/make-stress.mjs /tmp/waveform-stress
WAVEFORM_SAMPLE_DIR=/absolute/path/to/sample_data \
WAVEFORM_STRESS_DIR=/tmp/waveform-stress npm run test:e2e
```

Screenshots and browser traces are written under ignored `test-results/`. Only the synthetic demo should be used for shared screenshots.

## Remaining verification boundaries

The local browser checks use Chromium. Safari and Firefox have not been exercised here. Position processing and scientific metrics have sanity tests and were exercised with the supplied unlabelled recordings; numerical equivalence to the original algorithms has not been established with a curated labelled reference set. Full-population waveform-density images and exhaustive large autocorrelation pairs are outside this implementation's display model. Those differences are documented in [FEATURES.md](FEATURES.md).

The GitHub workflow is included. Deployment to the upstream Pages domain requires the upstream administrator to select the GitHub Actions publishing source and merge the pull request. Local `/waveform/` mount verification does not itself mean the live site has been deployed.
