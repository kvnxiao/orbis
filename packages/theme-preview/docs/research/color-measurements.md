# Advisory color measurements

Research date: 2026-09-13. The sources below were inspected as documentation and source code;
measurement implementations have not been executed for this package. Pi theme source was checked
against 0.87.0 on 2026-09-22.

## Contrast calculation and interpretation

APCA calculates a signed lightness-contrast value, Lc. Positive values describe dark text on a
lighter background; negative values describe light text on a darker background. Threshold
comparisons use the magnitude while displayed measurements preserve polarity. Color.js documents
APCA 0.0.98G-4g and accepts the background before the foreground.

APCA's published readability guidance depends on font size and weight. A terminal extension does not
know those physical text properties. Fixed role thresholds in a terminal preview are package
heuristics, not evidence of accessibility conformance. The published Lc 15 guidance for sufficiently
thick nontext elements does not establish a universal visibility boundary for terminal strokes.

Sources: [Color.js contrast documentation](https://colorjs.io/docs/contrast.html),
[APCA use-case guidance](https://git.apcacontrast.com/documentation/APCAeasyIntro.html).

## Implementation and licensing choices

Color.js contains an APCA implementation with local imports and distributes its repository under the
MIT license. The inspected APCA source does not contain a separate restrictive license header. This
provides a concrete implementation candidate for advisory calculations. A selected release still
needs its source, notices, and numerical behavior checked before dependency adoption.

The official `apca-w3` package has different terms, including web-content limitations. Those terms
must not be inferred from the algorithm name or applied automatically to Color.js. Myndex also
publishes integration and identification requirements; inspecting these documents does not determine
their applicability to independently distributed code. The preview's product contract does not claim
APCA tool certification or theme accessibility conformance.

Sources:
[Color.js APCA source](https://github.com/color-js/color.js/blob/main/src/contrast/APCA.js),
[Color.js MIT license](https://github.com/color-js/color.js/blob/main/LICENSE),
[apca-w3 license](https://github.com/Myndex/apca-w3/blob/master/LICENSE.md),
[Myndex integration document](https://git.apcacontrast.com/documentation/minimum_compliance.html).
Color.js source links identify the inspected main-branch files, not a selected dependency release.

## Secondary contrast and distinctness

The WCAG contrast ratio supplies a familiar secondary number. Its normal-text and large-text
criteria depend on the content being assessed; displaying the ratio does not certify terminal text.
The ratio is symmetric, unlike APCA, and threshold comparisons must precede display rounding.

CIEDE2000, displayed as ΔE2000, measures color difference. Color.js implements this metric and
documents a commonly used 2.3 just-noticeable-difference reference. The preview's 2.3 and 10 cutoffs
are advisory policy for its fixtures; they do not establish universal perceptual boundaries.

Color.js's default CIELAB conversion uses a D50 reference white. A calculation against a D65
contract needs a matching conversion; selecting a library does not establish that its default
color-space conversion reproduces the required numerical results.

Sources:
[WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[Color.js color differences](https://colorjs.io/docs/color-difference.html),
[Color.js CIELAB source](https://github.com/color-js/color.js/blob/main/src/spaces/lab.js).

## Built-in themes and semantic roles

Pi 0.87.0's dark and light themes each assign the same color to `syntaxOperator` and
`syntaxPunctuation`. Both also reuse the selection background for search matches. Treating every
equal color as a warning would flag these assignments. Role-aware reporting can warn about semantic
state distinctions while reporting general syntax and surface similarities as information. Built-in
themes can still receive contrast warnings.

The installed built-in themes resolve `text` to explicit hex colors through variables. Themes may
still use empty values for terminal defaults; the built-in examples do not remove that input case.

Sources:
[dark theme](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/modes/interactive/theme/dark.json),
[light theme](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/modes/interactive/theme/light.json).

## Color-vision simulation

Machado, Oliveira, and Fernandes describe a physiological model for simulated color-vision
deficiency. Its full-deficiency transforms and the Brettel model are candidates for checking
semantic color distinctions. Color-vision simulations estimate changed color perception; they do not
predict every viewer's perception or establish readability. An implementation must document its
selected model, parameters, color conversion, and gamut treatment before numerical checks are
reproducible.

Source:
[Machado's thesis, including the model and its evaluation](https://www.inf.ufrgs.br/~oliveira/students_dissertations/Masters/Gustavo_Machado_Masters_thesis_UFRGS_2010.pdf).
The associated model was published in IEEE Transactions on Visualization and Computer Graphics
in 2009. Simulation-library selection and numerical verification remain implementation work.
