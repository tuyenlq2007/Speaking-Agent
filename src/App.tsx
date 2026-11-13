import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  beginListening,
  completeModelPlayback,
  consumeTranscript,
  createInputState,
  failRecoverably,
  MAX_ATTEMPTS,
  retryAfterError,
  startPractice,
  type PracticeError,
  type PracticeState,
  type ReadyPhase,
  type SpeakingPhase
} from "./domain/practiceFlow";
import { tokenizeForDisplay } from "./domain/matcher";
import { splitIntoSentences } from "./domain/sentences";
import { RecognitionError, SpeechService } from "./services/speech";
import { WhisperRecognitionService } from "./services/whisperRecognition";
import { translateToVietnamese } from "./services/translation";
import { sampleTopics } from "./data/sampleSentences";
import { createSampleQueue } from "./domain/sampleQueue";

const MAX_PASSAGE_LENGTH = 6000;

const errorCopy: Record<PracticeError, { title: string; detail: string }> = {
  "permission-denied": {
    title: "Chưa thể dùng micrô",
    detail: "Hãy cho phép trang này truy cập micrô trong phần cài đặt của trình duyệt, rồi thử lại."
  },
  "no-speech": {
    title: "Mình chưa nghe thấy bạn",
    detail: "Hãy nói gần micrô hơn và thử lại. Lần này không bị tính vào số lượt."
  },
  network: {
    title: "Dịch vụ nhận dạng đang ngoại tuyến",
    detail: "Nhận dạng giọng nói của trình duyệt có thể cần Internet. Kiểm tra kết nối rồi thử lại."
  },
  unavailable: {
    title: "Tạm thời chưa thể nhận dạng",
    detail: "Dịch vụ giọng nói chưa sẵn sàng. Tiến độ của bạn vẫn được giữ nguyên."
  },
  aborted: {
    title: "Đã dừng nghe",
    detail: "Không sao — lượt này không bị tính. Bạn có thể thử lại khi sẵn sàng."
  },
  synthesis: {
    title: "Chưa thể phát giọng mẫu",
    detail: "Kiểm tra âm lượng thiết bị rồi thử phát lại."
  }
};

function validatePassage(value: string): string | null {
  if (!value.trim()) return "Nhập một đoạn văn tiếng Anh để bắt đầu.";
  if (value.length > MAX_PASSAGE_LENGTH) return `Đoạn văn cần ngắn hơn hoặc bằng ${MAX_PASSAGE_LENGTH} ký tự.`;
  if (splitIntoSentences(value).length === 0) return "Đoạn văn cần có ít nhất một câu tiếng Anh.";
  return null;
}

function phaseStep(phase: PracticeState["phase"]): number {
  if (phase === "input") return 0;
  if (phase.includes("initial") || phase === "speaking-model-sentence" || phase === "reviewing-initial-reading") return 1;
  if (phase.includes("word") || phase.includes("final")) return 2;
  if (phase === "results") return 3;
  return 1;
}

function App() {
  const [draft, setDraft] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [state, setState] = useState<PracticeState>(createInputState);
  const [voiceWarning, setVoiceWarning] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [sentences, setSentences] = useState<string[]>([]);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [sentenceResults, setSentenceResults] = useState<PracticeState[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [passageNumber, setPassageNumber] = useState(1);
  const nextSample = useRef<(() => string) | null>(null);
  const [translation, setTranslation] = useState("");
  const [translationStatus, setTranslationStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const speech = useRef<SpeechService | null>(null);
  const recognition = useRef<WhisperRecognitionService | null>(null);
  const listeningOperation = useRef(false);
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [modelProgress, setModelProgress] = useState(0);

  if (!speech.current && typeof window !== "undefined") speech.current = new SpeechService();
  if (!recognition.current && typeof window !== "undefined") recognition.current = new WhisperRecognitionService();

  const supported = recognition.current?.supported ?? false;
  const activeStep = phaseStep(state.phase);
  const selectedTopic = sampleTopics.find((topic) => topic.id === selectedTopicId);

  useEffect(() => {
    if (state.phase !== "input") return;

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const scrollToPracticeInput = () => {
      window.requestAnimationFrame(() => {
        document.getElementById("practice-title")?.scrollIntoView({ block: "start" });
      });
    };

    scrollToPracticeInput();
    window.addEventListener("load", scrollToPracticeInput);
    return () => {
      window.removeEventListener("load", scrollToPracticeInput);
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    if (state.phase === "input" || state.phase === "results" || !state.sentence) {
      setTranslation("");
      setTranslationStatus("idle");
      return;
    }

    const controller = new AbortController();
    setTranslation("");
    setTranslationStatus("loading");
    translateToVietnamese(state.sentence, controller.signal).then(
      (translated) => {
        setTranslation(translated);
        setTranslationStatus("ready");
      },
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setTranslationStatus("error");
      }
    );

    return () => controller.abort();
  }, [state.sentence, state.phase === "input" || state.phase === "results"]);

  useEffect(() => {
    if (state.phase !== "results") return;
    if (sentenceIndex < sentences.length - 1) {
      const nextIndex = sentenceIndex + 1;
      setSentenceResults((previous) => [...previous, state]);
      setSentenceIndex(nextIndex);
      setLiveTranscript("");
      setState(startPractice(sentences[nextIndex]));
      return;
    }
    if (!selectedTopicId || !nextSample.current) return;
    const passage = nextSample.current();
    const passageSentences = splitIntoSentences(passage);
    setDraft(passage);
    setSentences(passageSentences);
    setSentenceIndex(0);
    setSentenceResults([]);
    setPassageNumber((previous) => previous + 1);
    setLiveTranscript("");
    setState(startPractice(passageSentences[0]));
  }, [selectedTopicId, sentenceIndex, sentences, state]);

  useEffect(() => {
    if (!recognition.current?.supported) return;
    recognition.current.warmUp((percent) => setModelProgress(Math.round(percent))).then(
      () => setModelStatus("ready"),
      () => setModelStatus("error")
    );
  }, []);

  useEffect(() => {
    const updateVoiceStatus = () => setVoiceWarning(!speech.current!.getVoiceSelection().exactBritishVoice);
    updateVoiceStatus();
    window.speechSynthesis.addEventListener?.("voiceschanged", updateVoiceStatus);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", updateVoiceStatus);
  }, []);

  useEffect(() => {
    const activeSpeechPhases: SpeakingPhase[] = [
      "speaking-model-sentence",
      "speaking-model-final-sentence"
    ];
    if (!activeSpeechPhases.includes(state.phase as SpeakingPhase)) return;
    const phase = state.phase as SpeakingPhase;
    const text = state.sentence;
    if (!text) return;
    let active = true;
    setLiveTranscript("");
    speech.current!.speak(text).then(
      () => active && setState((previous) => previous.phase === phase ? completeModelPlayback(previous) : previous),
      () => active && setState((previous) => previous.phase === phase
        ? failRecoverably(previous, "synthesis", phase)
        : previous)
    );
    return () => {
      active = false;
      speech.current?.cancel();
    };
  }, [state.phase, state.sentence]);

  useEffect(() => () => {
    listeningOperation.current = false;
    speech.current?.cancel();
    recognition.current?.stop();
  }, []);

  const handleTopicChange = (topicId: string) => {
    const topic = sampleTopics.find((item) => item.id === topicId);
    setSelectedTopicId(topic?.id ?? "");
    nextSample.current = topic ? createSampleQueue(topic.samples) : null;
    if (nextSample.current) setDraft(nextSample.current());
    setValidation(null);
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    setSelectedTopicId("");
    nextSample.current = null;
    if (validation) setValidation(validatePassage(value));
  };

  const handleStart = useCallback(() => {
    const error = validatePassage(draft);
    setValidation(error);
    if (error) return;
    const passageSentences = splitIntoSentences(draft);
    setSentences(passageSentences);
    setSentenceIndex(0);
    setSentenceResults([]);
    setPassageNumber(1);
    setLiveTranscript("");
    setState(startPractice(passageSentences[0]));
  }, [draft]);

  const runRecognition = useCallback(async (readyPhase: ReadyPhase) => {
    if (!supported || listeningOperation.current) return;
    listeningOperation.current = true;
    const listeningPhase = beginListening({ ...createInputState(), phase: readyPhase }).phase;
    speech.current?.cancel();
    setLiveTranscript("");
    setState((previous) => previous.phase === readyPhase ? beginListening(previous) : previous);
    try {
      const transcript = await recognition.current!.listen((partialTranscript) => {
        setLiveTranscript(partialTranscript);
      });
      setState((previous) => previous.phase === listeningPhase ? consumeTranscript(previous, transcript) : previous);
    } catch (error) {
      const code: PracticeError = error instanceof RecognitionError ? error.code : "unavailable";
      setState((previous) => previous.phase === listeningPhase
        ? failRecoverably(previous, code, readyPhase)
        : previous);
    } finally {
      listeningOperation.current = false;
    }
  }, [supported]);

  useEffect(() => {
    const readyPhases: ReadyPhase[] = [
      "ready-for-initial-reading",
      "ready-for-final-reading"
    ];
    if (readyPhases.includes(state.phase as ReadyPhase)) {
      void runRecognition(state.phase as ReadyPhase);
    }
  }, [runRecognition, state.phase]);

  const handleListen = useCallback(() => {
    if (state.phase.startsWith("ready")) void runRecognition(state.phase as ReadyPhase);
  }, [runRecognition, state.phase]);

  const replay = useCallback(async (text: string) => {
    if (isReplaying) return;
    setIsReplaying(true);
    try {
      await speech.current!.speak(text);
    } catch {
      // The main flow exposes synthesis errors; replay is optional and can simply be retried.
    } finally {
      setIsReplaying(false);
    }
  }, [isReplaying]);

  const retryPassage = () => {
    if (!sentences.length) return;
    setSentenceIndex(0);
    setSentenceResults([]);
    setLiveTranscript("");
    setState(startPractice(sentences[0]));
  };
  const startNewPassage = () => {
    listeningOperation.current = false;
    speech.current?.cancel();
    recognition.current?.stop();
    setState(createInputState());
    setSentences([]);
    setSentenceIndex(0);
    setSentenceResults([]);
    setDraft("");
    setLiveTranscript("");
    setValidation(null);
    setSelectedTopicId("");
    nextSample.current = null;
    setPassageNumber(1);
  };

  const displayedWords = useMemo(() => {
    if (state.words.length) return state.words;
    return tokenizeForDisplay(draft).map((token) => ({ ...token, status: "pending" as const }));
  }, [draft, state.words]);

  return (
    <main className="page-shell">
      <header className="site-header">
        <button className="brand" type="button" onClick={startNewPassage} aria-label="Về trang bắt đầu">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>SpeakRight</span>
        </button>
        <p className="header-note"><span aria-hidden="true">●</span> Luyện nói riêng tư trên trình duyệt</p>
      </header>

      {state.phase === "input" ? (
        <InputView
          draft={draft}
          validation={validation}
          supported={supported}
          voiceWarning={voiceWarning}
          modelStatus={modelStatus}
          modelProgress={modelProgress}
          onDraftChange={handleDraftChange}
          onStart={handleStart}
          onReplay={() => replay(splitIntoSentences(draft)[0] ?? "")}
          selectedTopicId={selectedTopicId}
          onTopicChange={handleTopicChange}
          onRandomSample={() => { if (nextSample.current) setDraft(nextSample.current()); }}
          replaying={isReplaying}
        />
      ) : state.phase === "results" ? (
        <ResultView results={[...sentenceResults, state]} onRetry={retryPassage} onNew={startNewPassage} />
      ) : (
        <PracticeView
          state={state}
          words={displayedWords}
          activeStep={activeStep}
          supported={supported}
          voiceWarning={voiceWarning}
          replaying={isReplaying}
          transcript={liveTranscript || state.transcript}
          translation={translation}
          translationStatus={translationStatus}
          sentenceIndex={sentenceIndex}
          sentenceCount={sentences.length}
          topicLabel={selectedTopic?.label}
          passageNumber={passageNumber}
          onListen={handleListen}
          onReplay={() => replay(state.sentence)}
          onRetryError={() => setState((previous) => retryAfterError(previous))}
          onExit={startNewPassage}
        />
      )}

      <footer>
        <span>SpeakRight</span>
        <span>Phản hồi mang tính gần đúng · Không lưu bản ghi âm</span>
      </footer>
      <div className="sr-only" aria-live="polite">
        {state.phase.startsWith("listening") ? "Đang nghe" : ""}
      </div>
    </main>
  );
}

interface InputViewProps {
  draft: string;
  validation: string | null;
  supported: boolean;
  voiceWarning: boolean;
  modelStatus: "loading" | "ready" | "error";
  modelProgress: number;
  replaying: boolean;
  onDraftChange(value: string): void;
  onStart(): void;
  onReplay(): void;
  selectedTopicId: string;
  onTopicChange(topicId: string): void;
  onRandomSample(): void;
}

function InputView(props: InputViewProps) {
  const topic = sampleTopics.find((item) => item.id === props.selectedTopicId);
  return (
    <div className="hero-grid">
      <section className="hero-copy">
        <p className="eyebrow">YOUR DAILY SPEAKING PRACTICE</p>
        <h1>Nói tiếng Anh rõ hơn, <em>từng câu một.</em></h1>
        <p className="lede">Chọn chủ đề hoặc dán đoạn văn của bạn, sau đó luyện lần lượt từng câu. Khi hoàn thành một đoạn mẫu, SpeakRight tự tải đoạn ngẫu nhiên tiếp theo trong cùng chủ đề.</p>
        <div className="how-it-works" aria-label="Cách luyện tập">
          <div><span>01</span><p><strong>Chọn chủ đề</strong><br />Tải ngẫu nhiên một đoạn mẫu hoặc nhập đoạn riêng.</p></div>
          <div><span>02</span><p><strong>Luyện từng câu</strong><br />Chỉ nghe mẫu và thu âm câu đang hiển thị.</p></div>
          <div><span>03</span><p><strong>Tiếp tục tự động</strong><br />Thử lại tối đa một lần rồi chuyển sang câu kế tiếp.</p></div>
        </div>
      </section>

      <section className="input-card" aria-labelledby="practice-title">
        <div className="card-kicker"><span>✦</span> Bắt đầu luyện</div>
        <h2 id="practice-title">Bạn muốn luyện đoạn nào?</h2>
        <div className="topic-picker">
          <label htmlFor="practice-topic">Chủ đề luyện tập</label>
          <select
            id="practice-topic"
            value={props.selectedTopicId}
            onChange={(event) => props.onTopicChange(event.target.value)}
            aria-describedby="topic-help"
          >
            <option value="">Chọn chủ đề hoặc nhập đoạn riêng</option>
            {sampleTopics.map((item) => (
              <option key={item.id} value={item.id}>{item.label} ({item.samples.length} đoạn)</option>
            ))}
          </select>
          <p id="topic-help" className="topic-help" aria-live="polite">
            {topic
              ? `${topic.samples.length} đoạn mẫu · Tự động tải đoạn tiếp theo khi hoàn thành. Luyện hết danh sách trước khi lặp lại.`
              : "Chọn một chủ đề để luyện liên tục hoặc nhập đoạn văn riêng bên dưới."}
          </p>
          {topic && (
            <button className="quiet-button random-sample" type="button" onClick={props.onRandomSample}>↻ Đoạn ngẫu nhiên khác</button>
          )}
        </div>
        <label htmlFor="sentence">Đoạn văn tiếng Anh</label>
        <div className={`textarea-wrap ${props.validation ? "invalid" : ""}`}>
          <textarea
            id="sentence"
            value={props.draft}
            maxLength={MAX_PASSAGE_LENGTH}
            rows={6}
            placeholder="Ví dụ: The weather is lovely today. We should go for a walk."
            onChange={(event) => props.onDraftChange(event.target.value)}
            aria-describedby="sentence-error"
            aria-invalid={Boolean(props.validation)}
          />
          <span className="character-count">{props.draft.length} / {MAX_PASSAGE_LENGTH}</span>
        </div>
        <p id="sentence-error" className="field-error">{props.validation ?? ""}</p>
        <div className="input-actions">
          <button
            type="button"
            className="listen-model"
            onClick={props.onReplay}
            disabled={!props.draft.trim() || props.replaying}
          >
            <span aria-hidden="true">◖))</span> {props.replaying ? "Đang phát…" : "Nghe câu đầu"}
          </button>
          <button type="button" className="primary-action" onClick={props.onStart} disabled={!props.supported}>
            Bắt đầu luyện <span aria-hidden="true">→</span>
          </button>
        </div>
        {!props.supported && (
          <div className="notice error-notice" role="alert">
            Trình duyệt này chưa hỗ trợ nhận dạng giọng nói. Hãy dùng Chrome hoặc Edge phiên bản mới.
          </div>
        )}
        {props.modelStatus === "loading" && (
          <div className="notice" role="status">
            Đang tải mô hình nhận dạng Whisper{props.modelProgress ? ` (${props.modelProgress}%)` : ""}. Lần đầu có thể mất một lúc; các lần sau sẽ nhanh hơn.
          </div>
        )}
        {props.modelStatus === "error" && (
          <div className="notice error-notice" role="alert">Không tải được mô hình nhận dạng. Hãy kiểm tra kết nối Internet rồi tải lại trang.</div>
        )}
        {props.voiceWarning && (
          <div className="notice" role="status">Không tìm thấy giọng Anh-Anh; SpeakRight sẽ dùng giọng tiếng Anh gần nhất.</div>
        )}
        <PrivacyNote />
      </section>
    </div>
  );
}

function PrivacyNote() {
  return (
    <div className="privacy-note">
      <span aria-hidden="true">◇</span>
      <p><strong>Trước khi bật micrô</strong><br />Phản hồi chỉ kiểm tra gần đúng các từ trình duyệt nhận ra, không đánh giá chi tiết âm hay giọng. Nhà cung cấp trình duyệt có thể xử lý âm thanh trực tuyến; SpeakRight không lưu hoặc tải bản ghi lên máy chủ riêng.</p>
    </div>
  );
}

interface PracticeViewProps {
  state: PracticeState;
  words: PracticeState["words"];
  activeStep: number;
  supported: boolean;
  voiceWarning: boolean;
  replaying: boolean;
  transcript: string;
  translation: string;
  translationStatus: "idle" | "loading" | "ready" | "error";
  sentenceIndex: number;
  sentenceCount: number;
  topicLabel?: string;
  passageNumber: number;
  onListen(): void;
  onReplay(): void;
  onRetryError(): void;
  onExit(): void;
}

function PracticeView(props: PracticeViewProps) {
  const { state } = props;
  const listening = state.phase.startsWith("listening");
  const speaking = state.phase.startsWith("speaking");
  const ready = state.phase.startsWith("ready");
  const finalMode = state.phase.includes("final") || state.retryPhase?.includes("final");
  const attempt = state.attempts;
  const instruction = speaking
    ? finalMode ? "Nghe lại câu này" : "Hãy nghe câu mẫu"
    : listening
      ? "Đang nghe — hãy nói ngay bây giờ"
      : finalMode
          ? "Thử lại câu này lần cuối"
          : "Đọc câu khi bạn sẵn sàng";

  return (
    <div className="practice-layout">
      <nav className="stepper" aria-label="Tiến trình luyện tập">
        {["Nghe mẫu", "Đọc câu", "Thử lại nếu cần"].map((label, index) => (
          <div key={label} className={props.activeStep >= index + 1 ? "active" : ""}>
            <span>{props.activeStep > index + 1 ? "✓" : index + 1}</span><p>{label}</p>
          </div>
        ))}
      </nav>

      <section className="practice-card">
        <button className="quiet-button exit-button" type="button" onClick={props.onExit}>← {props.topicLabel ? "Đổi chủ đề" : "Đoạn mới"}</button>
        {props.topicLabel && (
          <p className="practice-topic">{props.topicLabel} · Đoạn {props.passageNumber} · Tự động chuyển đoạn</p>
        )}
        <p className="eyebrow">CÂU {props.sentenceIndex + 1} / {props.sentenceCount} · {finalMode ? "LƯỢT THỬ LẠI CUỐI" : "LƯỢT ĐỌC ĐẦU"}</p>
        <h1>{instruction}</h1>
        <p className="practice-hint">
          {speaking ? "Tập trung vào nhịp điệu và trọng âm. Micrô sẽ tự bật ngay sau đó." : listening ? "Nói tự nhiên, rõ ràng và không cần quá nhanh." : "Micrô đang chuẩn bị tự động bật."}
        </p>

        <div className="sentence-board" aria-label="Kết quả từng từ">
          {props.words.map((word, index) => {
            const visualStatus = word.status;
            const symbol = visualStatus === "correct" ? "✓" : visualStatus === "incorrect" || visualStatus === "missing" ? "!" : "•";
            return (
              <span key={`${word.original}-${index}`} className={`word-chip ${visualStatus}`} aria-label={`${word.original}: ${visualStatus}`}>
                <i aria-hidden="true">{symbol}</i>{word.original}
              </span>
            );
          })}
        </div>

        <div className={`translation ${props.translationStatus === "error" ? "translation-error" : ""}`} aria-live="polite">
          <span>Bản dịch tiếng Việt</span>
          {props.translationStatus === "ready"
            ? <p lang="vi">{props.translation}</p>
            : props.translationStatus === "error"
              ? <p>Tạm thời chưa thể tải bản dịch.</p>
              : <p>Đang dịch…</p>}
        </div>

        {(props.transcript || listening) && (
          <p className="transcript" aria-live="polite">
            <span>Bạn đang nói</span>{props.transcript ? `“${props.transcript}”` : "Đang nghe…"}
          </p>
        )}

        {state.phase === "recoverable-error" && state.error ? (
          <div className="error-panel" role="alert">
            <span aria-hidden="true">!</span>
            <div><strong>{errorCopy[state.error].title}</strong><p>{errorCopy[state.error].detail}</p></div>
            <button type="button" onClick={props.onRetryError}>Thử lại</button>
          </div>
        ) : (
          <div className="practice-controls">
            <button type="button" className="replay-button" onClick={props.onReplay} disabled={listening || speaking || props.replaying}>
              <span aria-hidden="true">◖))</span> Phát lại
            </button>
            <button
              type="button"
              className={`mic-button ${listening ? "recording" : ""}`}
              onClick={props.onListen}
              disabled={!ready || !props.supported}
              aria-label={listening ? "Đang nghe" : "Bắt đầu thu âm"}
            >
              <span aria-hidden="true">♩</span>
            </button>
            <div className="attempts" aria-label={`Đã dùng ${attempt} trên ${MAX_ATTEMPTS} lượt đọc`}>
              <span>Lượt đọc</span>
              <div>{Array.from({ length: MAX_ATTEMPTS }, (_, value) => <i key={value} className={value < attempt ? "used" : ""} />)}</div>
              <strong>{attempt} / {MAX_ATTEMPTS}</strong>
            </div>
          </div>
        )}

        {props.voiceWarning && <p className="voice-warning">Đang dùng giọng tiếng Anh thay thế vì thiết bị chưa có giọng Anh-Anh.</p>}
      </section>
      <PrivacyNote />
    </div>
  );
}

function ResultView({ results, onRetry, onNew }: { results: PracticeState[]; onRetry(): void; onNew(): void }) {
  const successfulSentences = results.filter((result) => result.successful).length;
  const totalAttempts = results.reduce((total, result) => total + result.attempts, 0);
  const correctWords = results.reduce(
    (total, result) => total + result.words.filter((word) => word.status === "correct").length,
    0
  );
  const totalWords = results.reduce((total, result) => total + result.words.length, 0);
  const allSuccessful = successfulSentences === results.length;
  return (
    <div className="result-wrap">
      <section className="result-card">
        <div className={`result-icon ${allSuccessful ? "success" : "keep-going"}`} aria-hidden="true">
          {allSuccessful ? "✓" : "↗"}
        </div>
        <p className="eyebrow">HOÀN THÀNH BÀI LUYỆN</p>
        <h1>{allSuccessful ? "Tuyệt lắm — bạn đã hoàn thành cả đoạn!" : "Bạn đã luyện xong từng câu trong đoạn."}</h1>
        <p className="result-lede">
          {allSuccessful
            ? "Trình duyệt đã nhận ra đầy đủ các từ trong tất cả câu."
            : "Các câu cần luyện thêm được đánh dấu bên dưới. Mỗi câu đã được thử lại không quá một lần."}
        </p>
        <div className="passage-results">
          {results.map((result, sentenceIndex) => (
            <div className="sentence-result" key={`${result.sentence}-${sentenceIndex}`}>
              <span className={result.successful ? "sentence-status success" : "sentence-status needs-work"}>
                {result.successful ? "✓" : "!"}
              </span>
              <div>
                <strong>Câu {sentenceIndex + 1}</strong>
                <p>{result.sentence}</p>
                {!result.successful && (
                  <small>
                    Cần luyện thêm: {result.wordsNeedingWork.map((index) => result.words[index]?.original).filter(Boolean).join(", ")}
                  </small>
                )}
              </div>
              <span className="sentence-attempts">{result.attempts} lượt</span>
            </div>
          ))}
        </div>
        <div className="result-stats">
          <div><span>Câu đã đọc đúng</span><strong>{successfulSentences} / {results.length}</strong></div>
          <div><span>Tổng lượt đọc</span><strong>{totalAttempts}</strong></div>
          <div><span>Từ đã nhận đúng</span><strong>{correctWords} / {totalWords}</strong></div>
        </div>
        <div className="result-actions">
          <button type="button" className="secondary-action" onClick={onRetry}>↻ Luyện lại đoạn này</button>
          <button type="button" className="primary-action" onClick={onNew}>Luyện đoạn mới →</button>
        </div>
        <p className="approximate-note">Kết quả chỉ phản ánh những từ trình duyệt nhận ra, không phải đánh giá âm vị hoặc chất lượng giọng.</p>
      </section>
    </div>
  );
}

export default App;
