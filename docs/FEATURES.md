# Original feature inventory and migration

Audited source: `gh-pages` at `bf0f51bd75cd44a6edecfa09e10e5ae68c5961c8`, especially `index_full.html`, `file-organiser.html`, `parsed-data.html`, `cut-object.html`, `wave-plots.html`, `cluster-plots.html`, `rm-plots.html`, `tac-plots.html`, `tile-wall.html`, `tile-element.html`, `header-view.html` and `undo-stack-view.html`. This inventory concerns the working original, not the abandoned rewrites.

## Files and navigation

| Original capability                                                            | Replacement                                                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Drag a mixed selection of large local files into the app                       | File and directory drop, file picker, folder picker; worker reads selected tetrode in bounded chunks       |
| Recognise LTX `.set`, `.pos`, `.N`, `.cut`, `.clu.N`                           | Supported; validates binary formats, declared spike counts, cut labels and truncation                      |
| Ignore auxiliary EEG/EGF, `.fet`, `.klg`, temporary CLu and rubbish `.0` files | Skipped; auxiliary/unrecognised files reported after import                                                |
| Group related files into trials and tetrodes                                   | Trial basename plus relative directory; separate folders can contain identical basenames                   |
| Match cut variants by basename or embedded trial reference                     | Both mechanisms; per-tetrode cut selector and incremental imports                                          |
| Multiple imported cuts and modified in-memory cuts                             | Each imported cut has independent state; Duplicate cut creates a local version                             |
| Remember the last cut and tetrode while navigating                             | Remembered per tetrode/trial during the workspace session                                                  |
| Fast numeric tetrode navigation, including tens digit                          | `0–9`, `O`; sidebar buttons; arrow keys change trials                                                      |
| Switch without reparsing unchanged position/set data                           | Cached population features, position variants and GPU buffers; selected-cut labels restored from IndexedDB |
| Export edited cut in original spike order                                      | `.cut` download plus `.clu.N` with explicit 1-based conversion                                             |
| Drag a generated cut file out to the desktop                                   | Replaced by explicit Export cut / Ctrl-or-Cmd-S                                                            |

## Cut editing

| Original capability                                              | Replacement                                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Default single unsorted group when no cut is supplied            | Cell 0 contains all spikes                                                                                                 |
| Source/destination groups, including multiple painting sources   | Source checkboxes; numeric destination; `F`/shift-`F`, `E`, Enter                                                          |
| Transfer spikes by painting amplitude projections                | Brush mask evaluated against every spike by Rust; point rendering budget does not restrict edits                           |
| Split a group using a waveform sample threshold                  | Exact full-file sample-column gate, with two cached columns per tetrode; subsequent cuts reuse the column                  |
| Merge groups                                                     | Selected cell → destination cell; undoable                                                                                 |
| Swap group identities                                            | Selected cell ↔ destination; undoable                                                                                      |
| Sort/relabel groups by spike count                               | Undoable renumber action in Settings. Modern adaptation: noise remains 0; other cells become 1…N in descending count order |
| Full undo, redo and human-readable action list                   | Sparse/dense immutable patches on disk; per-cut metadata; UI and keyboard controls                                         |
| Keep modified cut state while visiting another trial/tetrode/cut | Supported within the current tab                                                                                           |
| Fork cut state without overwriting disk input                    | Imported disk files remain unchanged; Duplicate cut creates a separately editable local version                            |
| Interactive waveform split updated while dragging                | Replaced by an explicit channel/sample/threshold/direction form with one atomic undo action                                |
| Drag/drop gesture for group merge and swap dialog                | Replaced by explicit Merge / Swap controls                                                                                 |

## Visualisation and analysis

| Original capability                                            | Replacement                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four-channel spike waveforms per group, coloured by group      | Instanced WebGL2 traces; same cell palette as projections and cell list                                                                             |
| Waveform flag/density palettes over every spike                | Bounded stratified waveform samples with translucent overdraw. Full-population waveform-density equivalence is not claimed                          |
| Many cell tiles                                                | Paged waveform overview using one context; searchable cell list and exact counts                                                                    |
| Six channel-pair amplitude projections                         | One WebGL2 canvas, shared amplitude/time/label buffers, six viewports                                                                               |
| Feature density and selectable group colouring                 | Additive point density, shared palette, selected-cell emphasis and isolation                                                                        |
| Drift view showing early/late spike times                      | Direct time colouring in the vertex shader; differs from the old smoothed mean-time-per-pixel image                                                 |
| Spatial spike/path plots                                       | Selected-cell trajectory + spike overlay; path/spike display sampled while rates use all assignments                                                |
| Spatial rate maps with physical bin width and smoothing        | Occupancy-normalised maps; adjustable bin size, boxcar radius and colour ceiling                                                                    |
| Directional rate maps                                          | LED orientation for dual LEDs, displacement direction for one LED; circular smoothing                                                               |
| Speed rate maps                                                | Occupancy-normalised speed tuning with adjustable bin width                                                                                         |
| Temporal autocorrelogram with configurable window and 100 bins | Positive-lag 100-bin histogram; self-spike excluded. Large/bursty groups use bounded reference/pair sampling, identified in the UI                  |
| Spike counts and peak rates                                    | Exact population counts, mean rate, spatial peak; additional refractory-interval percentage                                                         |
| One/two LED position processing                                | Both supported                                                                                                                                      |
| Correct LED swaps using pixel-size statistics and continuity   | Continuity correction is implemented; the original pixel-size z-score heuristic is not reproduced                                                   |
| Reject impossible jumps, interpolate missing position, smooth  | Configurable jump threshold and boxcar window; linear interpolation                                                                                 |
| Inspect set/position/tetrode/cut headers                       | Searchable set, position and tetrode headers; cut identity/count validation occurs during import, not in a separate cut-header viewer               |
| Detach/grab tiles/projections/path plots for comparisons       | Up to four pinned cell image snapshots remain while navigating. Arbitrary floating pane arrangements are replaced by the fixed responsive workspace |
| Copy active plots and information to clipboard                 | Cell plot + metadata copied as PNG; PNG download fallback; explicit image export                                                                    |
| Keyboard shortcuts and show/hide plot controls                 | In-app reference, major navigation/edit/view shortcuts, settings drawer                                                                             |
| Persist options between visits                                 | LocalStorage                                                                                                                                        |
| Console helpers and CSV conversion utilities                   | Not exposed as a supported UI/API; source is available for analysis tooling                                                                         |
| Chromium/Electron wrapper after browser features disappeared   | Replaced by standards-based ES modules, module workers, React and WebGL2; no Electron/Polymer/Bower runtime                                         |

## Scope and scientific interpretation

This is a browser exploration and manual-cut editor, not an automatic spike sorter. It does not introduce PCA, automated clustering, gridness scores or place-cell classifications absent from the audited application. It does not load continuous EEG/EGF signals.

The modern workflow covers the core import/explore/edit/export tasks. Differences above are deliberate and explicit: bounded waveform/projection rendering, sampled large autocorrelograms, fixed workspace layout, a simpler LED-swap heuristic and explicit editing controls. The original and replacement analysis results have not been shown numerically equivalent on curated labelled biological reference data. Validate analysis settings and results against the laboratory's established pipeline before relying on them for quantitative research conclusions.
