import {
  requestMockInterviewReport,
  requestMockInterviewTurn,
} from "@client/api/mock-interview";
import type {
  Job,
  MockInterviewReport,
  MockInterviewRound,
  MockInterviewTurn,
} from "@shared/types";
import {
  MOCK_INTERVIEW_ROUND_LABELS,
  MOCK_INTERVIEW_ROUNDS,
} from "@shared/types";
import {
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Phase = "setup" | "live" | "evaluating" | "report";

type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternative> & {
  isFinal: boolean;
};
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const tone =
    pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", tone)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

type MockInterviewButtonProps = {
  job: Job | null;
  triggerLabel?: string;
  triggerClassName?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
};

export const MockInterviewButton: React.FC<MockInterviewButtonProps> = ({
  job,
  triggerLabel = "Mock interview",
  triggerClassName,
  triggerVariant = "ghost",
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant={triggerVariant}
        className={triggerClassName}
        disabled={!job}
        onClick={() => setOpen(true)}
      >
        <Video className="mr-2 h-3.5 w-3.5" />
        {triggerLabel}
      </Button>
      {open && job ? (
        <MockInterviewRoom job={job} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
};

function MockInterviewRoom({
  job,
  onClose,
}: {
  job: Job;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [round, setRound] = useState<MockInterviewRound>("full");
  const [transcript, setTranscript] = useState<MockInterviewTurn[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MockInterviewReport | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = "mock-interview-title";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef<MockInterviewTurn[]>([]);
  const speechSupported = getSpeechRecognitionCtor() !== null;
  const speechLang =
    typeof navigator !== "undefined" ? navigator.language : "en-US";

  transcriptRef.current = transcript;

  const stopMedia = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopMedia();
  }, [stopMedia]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stopMedia();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [stopMedia, onClose]);

  // Attach the webcam stream once the <video> element is actually rendered
  // (phase "live"). Doing this in startInterview races React's commit and can
  // leave the camera invisible.
  useEffect(() => {
    if (phase === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const nextTurn = useCallback(
    async (nextTranscript: MockInterviewTurn[]) => {
      setBusy(true);
      setError(null);
      try {
        const result = await requestMockInterviewTurn(job.id, {
          round,
          transcript: nextTranscript,
        });
        const withInterviewer: MockInterviewTurn[] = [
          ...nextTranscript,
          { role: "interviewer", content: result.message },
        ];
        setTranscript(withInterviewer);
        setCurrentQuestion(result.message);
        speak(result.message);

        if (result.ended) {
          setPhase("evaluating");
          try {
            const generated = await requestMockInterviewReport(job.id, {
              round,
              transcript: withInterviewer,
            });
            setReport(generated);
            setPhase("report");
          } catch (reportError) {
            setError(
              reportError instanceof Error
                ? reportError.message
                : "Could not generate the interview report.",
            );
            setPhase("report");
          }
        }
      } catch (turnError) {
        setError(
          turnError instanceof Error
            ? turnError.message
            : "The interviewer could not respond. Try again.",
        );
      } finally {
        setBusy(false);
      }
    },
    [job.id, round, speak],
  );

  const startInterview = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      setPhase("live");
      await nextTurn([]);
    } catch {
      setError(
        "Camera/microphone access was denied. Allow access to start the interview.",
      );
    }
  }, [nextTurn]);

  const submitAnswer = useCallback(
    (text: string) => {
      const answer = text.trim();
      if (!answer || busy) return;
      recognitionRef.current?.stop();
      setListening(false);
      setAnswerDraft("");
      const updated: MockInterviewTurn[] = [
        ...transcriptRef.current,
        { role: "candidate", content: answer },
      ];
      setTranscript(updated);
      void nextTurn(updated);
    },
    [busy, nextTurn],
  );

  const toggleListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new Ctor();
    recognition.lang = speechLang;
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalText = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += text;
        else interim += text;
      }
      setAnswerDraft((finalText + interim).trim());
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [listening, speechLang]);

  const handleClose = () => {
    stopMedia();
    onClose();
  };

  const resetInterview = () => {
    stopMedia();
    setTranscript([]);
    setCurrentQuestion("");
    setAnswerDraft("");
    setReport(null);
    setError(null);
    setPhase("setup");
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur outline-none"
    >
      <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <div id={titleId} className="text-sm font-semibold text-foreground">
              Mock interview
            </div>
            <div className="text-xs text-muted-foreground">
              {job.title}
              {job.employer ? ` · ${job.employer}` : ""}
            </div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={handleClose}>
          <X className="mr-1.5 h-4 w-4" />
          End
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        {error ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">
            {error}
          </div>
        ) : null}

        {phase === "setup" ? (
          <div className="mx-auto flex max-w-md flex-col gap-5 pt-10 text-center">
            <h2 className="text-2xl font-semibold text-foreground">
              Choose your interview round
            </h2>
            <p className="text-sm text-muted-foreground">
              The AI interviewer asks questions based on this job and your CV,
              stays in character, and gives a scored report at the end.
            </p>
            <div className="flex flex-col gap-2">
              {MOCK_INTERVIEW_ROUNDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRound(value)}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                    round === value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/70 text-muted-foreground hover:border-border",
                  )}
                >
                  <span className="font-medium">
                    {MOCK_INTERVIEW_ROUND_LABELS[value]}
                  </span>
                </button>
              ))}
            </div>
            {!speechSupported ? (
              <p className="text-xs text-amber-400/80">
                Voice answers are not supported in this browser — you'll type
                your answers instead. The interviewer still speaks aloud.
              </p>
            ) : null}
            <Button onClick={() => void startInterview()} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Video className="mr-2 h-4 w-4" />
              )}
              Start interview
            </Button>
          </div>
        ) : null}

        {phase === "live" ? (
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border/70 bg-muted/20 p-6">
              <div
                className={cn(
                  "relative grid h-40 w-40 place-items-center rounded-full bg-gradient-to-br from-primary/70 to-primary/30 text-3xl font-semibold text-white transition-transform",
                  speaking && "scale-105",
                )}
              >
                AI
                {speaking ? (
                  <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary/60" />
                ) : null}
              </div>
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {speaking ? "Interviewer speaking…" : "Interviewer"}
              </div>
              <p className="max-h-40 overflow-y-auto text-center text-sm leading-6 text-foreground">
                {currentQuestion || "…"}
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="aspect-video w-full rounded-xl bg-black object-cover"
              >
                <track kind="captions" />
              </video>
              <textarea
                value={answerDraft}
                onChange={(event) => setAnswerDraft(event.target.value)}
                placeholder={
                  speechSupported
                    ? "Your answer appears here as you speak — or type it."
                    : "Type your answer…"
                }
                rows={4}
                className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <div className="flex items-center gap-2">
                {speechSupported ? (
                  <Button
                    type="button"
                    variant={listening ? "destructive" : "outline"}
                    size="sm"
                    onClick={toggleListening}
                    disabled={busy || speaking}
                  >
                    {listening ? (
                      <MicOff className="mr-2 h-4 w-4" />
                    ) : (
                      <Mic className="mr-2 h-4 w-4" />
                    )}
                    {listening ? "Stop" : "Answer by voice"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => submitAnswer(answerDraft)}
                  disabled={busy || !answerDraft.trim()}
                  className="ml-auto"
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send answer
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {phase === "evaluating" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">
              Scoring your interview…
            </div>
          </div>
        ) : null}

        {phase === "report" && report ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
            <div className="rounded-2xl border border-border/70 bg-muted/20 p-6 text-center">
              <div className="text-5xl font-bold text-foreground">
                {report.overallScore}
                <span className="text-xl text-muted-foreground">/100</span>
              </div>
              <div className="mt-2 text-sm font-medium text-primary">
                {report.recommendation}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {report.summary}
              </p>
            </div>

            {report.competencies.length > 0 ? (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-5">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Competencies
                </div>
                <div className="flex flex-col gap-3">
                  {report.competencies.map((competency) => (
                    <div key={competency.name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-sm text-foreground">
                        <span>{competency.name}</span>
                        <span className="text-muted-foreground">
                          {competency.score}
                        </span>
                      </div>
                      <ScoreBar score={competency.score} />
                      {competency.comment ? (
                        <p className="text-xs text-muted-foreground">
                          {competency.comment}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
                  Strengths
                </div>
                <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
                  {report.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-400">
                  Improve
                </div>
                <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
                  {report.improvements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={resetInterview}>
                <RefreshCw className="mr-2 h-4 w-4" />
                New interview
              </Button>
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        ) : null}

        {phase === "report" && !report ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-10 text-center">
            <p className="text-sm text-muted-foreground">
              The report could not be generated, but your practice still counts.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={resetInterview}>
                Try again
              </Button>
              <Button onClick={handleClose}>Close</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
