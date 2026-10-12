import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakButtons } from "./SpeakButtons";

// jsdom에는 오디오 재생과 speechSynthesis가 없어서 가짜로 끼운다
class FakeAudio {
  static all: FakeAudio[] = [];
  static nextPlay: (() => Promise<void>) | null = null;
  playbackRate = 1;
  paused = true;
  private listeners: Record<string, (() => void)[]> = {};
  constructor(public src: string) {
    FakeAudio.all.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  play() {
    this.paused = false;
    const next = FakeAudio.nextPlay;
    FakeAudio.nextPlay = null;
    return next ? next() : Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  emit(type: string) {
    this.listeners[type]?.forEach((fn) => fn());
  }
}

class FakeUtterance {
  voice: unknown = null;
  lang = "";
  rate = 1;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

type Voice = { lang: string; voiceURI: string };

function fakeSynth(voices: Voice[]) {
  const listeners = new Set<() => void>();
  const synth = {
    voices,
    getVoices: () => synth.voices,
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    fireVoicesChanged: () => listeners.forEach((fn) => fn()),
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return synth;
}

const FAILED = "소리를 재생하지 못했어요. 다시 눌러 보세요.";
const listen = (i = 0) => screen.getAllByRole("button", { name: "듣기" })[i];
const slow = (i = 0) => screen.getAllByRole("button", { name: "천천히 듣기" })[i];
const lastAudio = () => FakeAudio.all.at(-1) as FakeAudio;
const spoken = (synth: ReturnType<typeof fakeSynth>) => synth.speak.mock.calls.at(-1)?.[0] as FakeUtterance;

beforeEach(() => {
  FakeAudio.all = [];
  FakeAudio.nextPlay = null;
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SpeakButtons 파일", () => {
  it("[듣기]는 파일을 속도 1로, [천천히 듣기]는 0.75로 처음부터 재생한다", async () => {
    const user = userEvent.setup();
    render(<SpeakButtons source={{ kind: "file", src: "/audio/female/words/en-1-001.mp3" }} />);

    await user.click(listen());
    expect(lastAudio().src).toBe("/audio/female/words/en-1-001.mp3");
    expect(lastAudio().playbackRate).toBe(1);
    expect(lastAudio().paused).toBe(false);

    await user.click(slow());
    expect(FakeAudio.all).toHaveLength(2);
    expect(FakeAudio.all[0].paused).toBe(true);
    expect(lastAudio().playbackRate).toBe(0.75);
  });

  it("다른 버튼을 누르면 앞 소리를 멈춘다(페이지에서 소리는 하나)", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SpeakButtons source={{ kind: "file", src: "/a.mp3" }} />
        <SpeakButtons source={{ kind: "file", src: "/b.mp3" }} />
      </>,
    );

    await user.click(listen(0));
    await user.click(listen(1));

    expect(FakeAudio.all.map((a) => [a.src, a.paused])).toEqual([
      ["/a.mp3", true],
      ["/b.mp3", false],
    ]);
  });

  it("버튼이 사라지면 그 소리를 멈춘다", async () => {
    const user = userEvent.setup();
    const view = render(<SpeakButtons source={{ kind: "file", src: "/a.mp3" }} />);

    await user.click(listen());
    view.unmount();

    expect(lastAudio().paused).toBe(true);
  });

  it("파일을 못 불러오면 오류 문구를 보여 주고, 다시 누르면 지운다", async () => {
    const user = userEvent.setup();
    render(<SpeakButtons source={{ kind: "file", src: "/missing.mp3" }} />);

    await user.click(listen());
    act(() => lastAudio().emit("error"));
    expect(screen.getByRole("alert")).toHaveTextContent(FAILED);

    await user.click(listen());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("play()가 거부되면 오류 문구를 보여 준다", async () => {
    const user = userEvent.setup();
    render(<SpeakButtons source={{ kind: "file", src: "/a.mp3" }} />);

    FakeAudio.nextPlay = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
    await user.click(listen());

    expect(await screen.findByRole("alert")).toHaveTextContent(FAILED);
  });

  it("우리가 멈춰서 거부된 play()는 오류가 아니다", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SpeakButtons source={{ kind: "file", src: "/a.mp3" }} />
        <SpeakButtons source={{ kind: "file", src: "/b.mp3" }} />
      </>,
    );
    let rejectFirst!: (error: unknown) => void;
    FakeAudio.nextPlay = () => new Promise((_resolve, reject) => (rejectFirst = reject));

    await user.click(listen(0));
    await user.click(listen(1));
    await act(async () => rejectFirst(new DOMException("paused", "AbortError")));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("가운데 정렬과 작은 글자 버튼을 고를 수 있다", () => {
    const { container } = render(<SpeakButtons source={{ kind: "file", src: "/a.mp3" }} align="center" variant="compact" />);

    expect(container.firstElementChild).toHaveClass("items-center");
    expect(listen()).toHaveClass("text-xs");
  });
});

describe("SpeakButtons 브라우저 음성", () => {
  const VOICES: Voice[] = [
    { lang: "en-US", voiceURI: "en-voice" },
    { lang: "ja-JP", voiceURI: "ja-voice" },
  ];

  it("학습 언어 음성으로 표기를 지운 문장을 읽고, 천천히 듣기는 rate 0.75다", async () => {
    const user = userEvent.setup();
    const synth = fakeSynth(VOICES);
    render(<SpeakButtons source={{ kind: "speech", text: "[今日|きょう]は[月曜日|げつようび]です。", language: "ja" }} />);

    await user.click(listen());
    expect(spoken(synth).text).toBe("今日は月曜日です。");
    expect(spoken(synth).voice).toBe(VOICES[1]);
    expect(spoken(synth).rate).toBe(1);

    await user.click(slow());
    expect(synth.cancel).toHaveBeenCalled();
    expect(spoken(synth).rate).toBe(0.75);
  });

  it("학습 언어 음성이 없으면 버튼을 그리지 않는다", () => {
    fakeSynth([{ lang: "en-US", voiceURI: "en-voice" }]);
    render(<SpeakButtons source={{ kind: "speech", text: "はい", language: "ja" }} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("speechSynthesis가 없으면 버튼을 그리지 않는다", () => {
    render(<SpeakButtons source={{ kind: "speech", text: "Hi", language: "en" }} />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("음성 목록이 늦게 오면 voiceschanged 뒤에 버튼을 보여 준다", () => {
    const synth = fakeSynth([]);
    render(<SpeakButtons source={{ kind: "speech", text: "Hi", language: "en" }} />);
    expect(screen.queryByRole("button")).toBeNull();

    synth.voices = VOICES;
    act(() => synth.fireVoicesChanged());

    expect(listen()).toBeInTheDocument();
  });

  it("음성 오류는 문구를 보여 주고, 우리가 멈춰서 생긴 중단은 오류가 아니다", async () => {
    const user = userEvent.setup();
    const synth = fakeSynth(VOICES);
    render(<SpeakButtons source={{ kind: "speech", text: "Hi", language: "en" }} />);

    await user.click(listen());
    act(() => spoken(synth).onerror?.({ error: "interrupted" }));
    act(() => spoken(synth).onerror?.({ error: "canceled" }));
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => spoken(synth).onerror?.({ error: "synthesis-failed" }));
    expect(screen.getByRole("alert")).toHaveTextContent(FAILED);
  });

  it("파일 재생 중에 대화 [듣기]를 누르면 파일을 멈춘다", async () => {
    const user = userEvent.setup();
    fakeSynth(VOICES);
    render(
      <>
        <SpeakButtons source={{ kind: "file", src: "/a.mp3" }} />
        <SpeakButtons source={{ kind: "speech", text: "Hi", language: "en" }} variant="compact" />
      </>,
    );

    await user.click(listen(0));
    await user.click(listen(1));

    expect(lastAudio().paused).toBe(true);
  });
});
