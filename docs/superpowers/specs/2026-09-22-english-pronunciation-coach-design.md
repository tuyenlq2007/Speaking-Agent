# English Pronunciation Coach — Design Specification

## 1. Product goal

Build a single-page website for Vietnamese learners who want to practise English pronunciation independently. A learner enters one English sentence, hears a British English model, reads the sentence aloud, and receives approximate word-level feedback. Words that were not recognised correctly are practised individually before the learner reads the complete sentence again.

The website must run without an application backend, account, or user-provided API key. It uses browser speech capabilities and clearly describes its feedback as approximate rather than phoneme-level pronunciation assessment.

## 2. Target user and success criteria

The primary user is a Vietnamese English learner using a microphone on a phone or computer. The interface, instructions, errors, and privacy notice are written in Vietnamese. English is used for the practice content.

The experience is successful when the learner can:

1. Enter an English sentence of up to 200 characters.
2. Hear the sentence spoken using a British English voice when one is available.
3. Read the sentence and see which expected words were or were not recognised.
4. Practise each unrecognised word, moving on immediately after success or after three failed attempts.
5. Read the complete sentence again, finishing immediately after success or after three failed attempts.
6. Review the final result and either retry the same sentence or start a new one.

## 3. Scope

### Included

- A responsive single-page interface for desktop and mobile browsers.
- English sentence input with a 200-character limit.
- British English speech synthesis (`en-GB`) with a documented fallback.
- Browser speech recognition configured for British English.
- Word-level comparison between the expected sentence and recognised transcript.
- Individual retry loops for words not recognised correctly.
- A final full-sentence retry loop.
- Clear browser, microphone, recognition, voice, and network error states.
- Automated tests for deterministic application logic and mocked browser speech adapters.

### Excluded

- Accounts, cloud persistence, progress history, leaderboards, or teacher dashboards.
- A custom backend or API key configuration.
- Phoneme-level scoring, accent classification, or claims of clinical/linguistic accuracy.
- On-device machine-learning models.
- Recording storage or audio uploads managed by the application.

## 4. Technical approach

The application is a static React and TypeScript project built with Vite and managed with npm. Browser-specific speech functionality is isolated behind small adapters so that the practice flow and matching logic remain deterministic and testable.

The project supports this local production workflow:

1. Run `npm install` to install dependencies.
2. Run `npm run build` to type-check and create a production bundle.
3. Deploy the generated `dist/` directory as a static site on Netlify.

The production bundle must use relative or root-safe asset paths supported by a Netlify site deployed at its domain root. The application has only one route, so it does not require a history-API redirect rule.

### Main modules

- **PracticeFlow** owns the state machine and transitions between input, demonstration, initial reading, word practice, final reading, and results.
- **SpeechService** wraps `window.speechSynthesis`, selects an `en-GB` voice, and speaks a sentence or individual word.
- **RecognitionService** wraps `SpeechRecognition` or `webkitSpeechRecognition`, configures recognition with `en-GB`, and emits a transcript or a typed error.
- **WordMatcher** normalises and tokenises text, aligns expected and recognised words, and returns the status of each expected word.
- **PracticeView** renders the sentence, word statuses, current instruction, microphone control, and remaining attempts.
- **ResultView** renders the outcome and the actions to retry or begin a new sentence.

No business logic depends directly on browser speech globals. UI components call the adapters through narrow interfaces, allowing automated tests to provide fakes.

## 5. Practice state machine

The flow has the following states:

1. `input` — the learner enters a sentence.
2. `speaking-model-sentence` — the website reads the complete sentence.
3. `ready-for-initial-reading` — the learner can start the microphone.
4. `listening-initial-reading` — speech recognition is active.
5. `reviewing-initial-reading` — the transcript is aligned with the expected sentence.
6. `speaking-model-word` — the current incorrect word is read aloud.
7. `ready-for-word-retry` — the learner can start an isolated-word attempt.
8. `listening-word-retry` — recognition is active for that word.
9. `speaking-model-final-sentence` — the sentence is read again after all incorrect words have been processed.
10. `ready-for-final-reading` — the learner can start a final sentence attempt.
11. `listening-final-reading` — recognition is active for the current final attempt.
12. `results` — the session has succeeded or reached its final attempt limit.
13. `recoverable-error` — progress is preserved while the learner retries an operation that did not count as an attempt.

Only one speech synthesis or recognition operation may run at a time. Starting recognition cancels active synthesis. Leaving a listening state stops recognition and releases related event handlers.

### Initial reading

The initial reading has no retry limit of its own. It establishes which words require focused practice. If recognition reports no speech or a recoverable service error, no result is generated and the learner can retry without penalty.

### Individual word practice

Incorrect expected words are processed from left to right. Before every attempt, the website speaks the current word. A successful recognition moves immediately to the next incorrect word. A failed recognition increments the attempt count; after the third failed attempt, the flow records the word as needing more practice and moves on. No-speech and recoverable service errors do not consume an attempt.

### Final sentence practice

After all individual words are processed, the website speaks the complete sentence again. The learner then has up to three recognised attempts. A completely matched sentence finishes immediately with success. Otherwise the flow returns feedback, speaks the sentence again, and offers the next attempt. After the third failed attempt, the session finishes and lists words that still need work. No-speech and recoverable service errors do not consume an attempt.

## 6. Text normalisation and word matching

Comparison is based on recognised words, not acoustic or phoneme analysis.

Normalisation:

- Convert text to lowercase.
- Normalise typographic apostrophes to straight apostrophes.
- Remove punctuation that is not part of an English contraction.
- Collapse repeated whitespace.
- Preserve the original display form separately from the comparison token.

The matcher uses sequence alignment based on edit distance rather than comparing tokens at the same array index. This prevents one missing or inserted word from causing all later words to be marked incorrectly.

For every expected token, the matcher returns one of:

- `correct` — aligned with the same recognised token.
- `incorrect` — aligned with a different recognised token.
- `missing` — no recognised token aligned to it.

Extra recognised tokens are retained in diagnostic matcher output for testing but are not displayed as expected-word chips. Both `incorrect` and `missing` expected tokens enter the focused word-practice queue.

Contractions are compared in their written form. The first version does not maintain a pronunciation dictionary or equate alternative transcript spellings such as `cannot` and `can't`; this limitation is covered by the approximate-feedback notice.

## 7. Speech synthesis and recognition

### Speech synthesis

The voice selector prefers voices whose language is exactly `en-GB`. If none exists, it uses another English voice and displays a non-blocking warning. Voice loading is asynchronous on browsers that populate `speechSynthesis.getVoices()` after the page loads.

The learner can replay a model sentence or the current model word while not recording. Speech rate uses a clear, slightly reduced default suitable for learners, while preserving natural pronunciation.

### Speech recognition

Recognition uses the browser's `SpeechRecognition` implementation, including the prefixed `webkitSpeechRecognition` form where required. It runs in non-continuous mode with interim results disabled and language set to `en-GB`.

The application itself has no backend. The privacy notice must state that the browser vendor may process microphone audio remotely and that on-device processing is not guaranteed.

Chrome and Edge are the supported target browsers for the first version. Unsupported browsers receive a clear Vietnamese explanation rather than a broken microphone control.

## 8. User interface

The visual style is friendly, calm, and focused on a single action at a time. The page contains:

- A compact header with the product name **SpeakRight** and a Vietnamese description.
- An input card with the sentence field, character count, model playback, and primary start action.
- A practice card that displays expected words as status chips.
- A prominent microphone control with an icon and text label.
- A live instruction area, current attempt count, and remaining attempts.
- A result card with the final outcome, words needing more practice, **Thử lại câu này**, and **Luyện câu mới** actions.

Word states do not rely on colour alone:

- Correct: green plus a check icon and accessible label.
- Incorrect: red plus an error icon and accessible label.
- Current practice word: amber plus a focus indicator and accessible label.
- Pending: neutral styling.

The interface disables actions that conflict with the active state. It provides keyboard focus styles, status announcements through an ARIA live region, and sufficiently large touch targets.

## 9. Error handling

- **Unsupported speech recognition:** recommend current Chrome or Edge and disable the practice start action.
- **Microphone permission denied:** explain in Vietnamese how to grant permission and provide a retry action.
- **No speech detected:** preserve state and attempts, then ask the learner to try again.
- **Recognition aborted or temporarily unavailable:** preserve state and attempts and expose a retry action.
- **Network/service failure:** explain that browser recognition may require connectivity, preserve state, and expose retry.
- **Missing British voice:** fall back to the nearest available English voice with a visible warning.
- **Synthesis failure:** preserve state and allow model playback to be retried.
- **Empty or invalid sentence:** require trimmed input containing at least one English letter and no more than 200 characters; otherwise prevent practice from starting and show an inline validation message.

Errors that do not produce a usable transcript never consume an attempt.

## 10. Accuracy and privacy communication

Before the first microphone request, the application explains in Vietnamese that:

- Feedback is an approximate check of whether the browser recognised the expected words.
- It is not a detailed assessment of individual English sounds or accent quality.
- The browser provider may process audio through an online speech service.
- The application does not store or upload recordings to its own server.

The results screen repeats the approximate-feedback label in concise form.

## 11. Testing strategy

### Automated tests

- Normalisation of case, punctuation, apostrophes, and whitespace.
- Sequence alignment for equal sentences, substitutions, omissions, and insertions.
- Construction and ordering of the incorrect-word queue.
- Immediate progression after a successful word attempt.
- Progression after the third failed word attempt.
- Immediate success after a fully matched final sentence.
- Termination after the third failed final-sentence attempt.
- Preservation of attempt counts for no-speech and recoverable errors.
- State-machine prevention of overlapping synthesis and recognition.
- Speech adapter behaviour using mocked browser APIs.
- Voice selection and English fallback behaviour.

### Manual verification

- Complete the full flow on current desktop Chrome and Edge.
- Verify microphone permission grant, denial, recovery, and no-speech behaviour.
- Verify an `en-GB` voice is selected when available.
- Verify responsive use on a mobile-sized viewport and, where available, a physical mobile browser.
- Complete the flow using keyboard navigation and confirm live status announcements.
- Confirm retrying the same sentence and starting a new sentence reset the correct state.
- Run `npm install` from a clean dependency state, then run `npm run build` successfully.
- Serve the generated `dist/` folder locally and complete a production-build smoke test.
- Confirm `dist/` contains a deployable entry page and its referenced static assets.

## 12. Acceptance criteria

The first version is complete when:

- It can be deployed as static files without a backend or API key.
- `npm install` installs the project and `npm run build` produces the Netlify-ready `dist/` directory.
- A Vietnamese learner can complete the full designed practice flow.
- Every incorrect word receives at most three counted attempts and exits early on success.
- The final sentence receives at most three counted attempts and exits early on success.
- Alignment does not cascade errors after a single insertion or omission.
- Unsupported APIs and recoverable speech errors are handled without losing valid progress.
- The British English preference, fallback, browser support, privacy behaviour, and approximate nature of feedback are visible and accurate.
- Automated tests pass and the manual Chrome/Edge checks have been completed.
