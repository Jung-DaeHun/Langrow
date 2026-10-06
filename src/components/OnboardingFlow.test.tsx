import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingStart } from "@/lib/onboarding";
import { api, type ApiResult } from "@/services/apiClient";
import { OnboardingFlow } from "./OnboardingFlow";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const replace = vi.fn();
const scrollTo = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  replace.mockReset();
  scrollTo.mockReset();
  vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>);
  vi.stubGlobal("scrollTo", scrollTo);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(start: Exclude<OnboardingStart, { kind: "home" }>) {
  const user = userEvent.setup();
  render(<OnboardingFlow start={start} />);
  return user;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ok: ApiResult<unknown> = { ok: true, status: 200, data: {} };
const CONFLICT_MESSAGE = "이미 처리된 요청이에요. 화면을 새로 고쳐 주세요.";

describe("OnboardingFlow 동의 단계", () => {
  it("워드마크와 1 / 3 진행을 보여 주고, 체크 전에는 [동의하고 계속]이 비활성화다", async () => {
    const user = setup({ kind: "consent" });

    expect(screen.getByText("Langrow")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText(/Anthropic\(미국\)/)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "동의하고 계속" });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /\[필수\] 만 14세 이상이며/ }));

    expect(submit).toBeEnabled();
  });

  it("이용약관과 개인정보처리방침은 새 탭 링크다", () => {
    setup({ kind: "consent" });

    expect(screen.getByRole("link", { name: "이용약관" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "이용약관" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "개인정보처리방침" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "개인정보처리방침" })).toHaveAttribute("target", "_blank");
  });

  it("동의 API를 body 없이 부르고, 성공하면 언어 단계로 가서 맨 위로 스크롤한다", async () => {
    apiMock.mockResolvedValue(ok);
    const user = setup({ kind: "consent" });

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "동의하고 계속" }));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/me/consent");
    expect(apiMock.mock.calls[0]).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "어떤 언어를 배울까요?" })).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("start.language가 있으면 동의 뒤 그 언어의 레벨 단계로 바로 간다", async () => {
    apiMock.mockResolvedValue(ok);
    const user = setup({ kind: "consent", language: "ja" });

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "동의하고 계속" }));

    expect(screen.getByRole("heading", { name: "일본어 레벨을 골라 주세요" })).toBeInTheDocument();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  it("요청 중에는 버튼을 비활성화하고, 실패하면 서버 문구를 보여 주며 체크를 유지한다", async () => {
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValue(pending.promise);
    const user = setup({ kind: "consent" });

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "동의하고 계속" }));
    expect(screen.getByRole("button", { name: "동의하고 계속" })).toBeDisabled();

    pending.resolve({ ok: false, status: 500, code: "INTERNAL", message: "잠시 후 다시 시도해 주세요." });

    expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "동의하고 계속" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "어떤 언어를 배울까요?" })).toBeNull();
  });
});

describe("OnboardingFlow 언어 단계", () => {
  it("언어 타일 2개를 radiogroup으로 두고, 누르면 그 언어의 레벨 단계로 간다", async () => {
    const user = setup({ kind: "language" });

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    const radios = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveTextContent("영어");
    expect(radios[1]).toHaveTextContent("일본어");

    await user.click(radios[1]);

    expect(screen.getByRole("heading", { name: "일본어 레벨을 골라 주세요" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("레벨 단계의 [이전]으로 언어 단계에 돌아가면 고른 언어가 선택돼 있다", async () => {
    const user = setup({ kind: "language" });

    await user.click(screen.getByRole("radio", { name: "영어" }));
    await user.click(screen.getByRole("button", { name: "이전" }));

    expect(screen.getByRole("heading", { name: "어떤 언어를 배울까요?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "영어" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "일본어" })).toHaveAttribute("aria-checked", "false");
  });
});

describe("OnboardingFlow 레벨 단계", () => {
  it("레벨 타일 5개에 이름·설명을 보여 주고, 고르기 전에는 [학습 시작]이 비활성화다", async () => {
    const user = setup({ kind: "level", language: "en", mode: "first" });

    const radios = within(screen.getByRole("radiogroup")).getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(radios[0]).toHaveTextContent("입문");
    expect(radios[2]).toHaveTextContent("중급");
    expect(radios[2]).toHaveTextContent("일상 대화를 자연스럽게 이어 가요");
    expect(screen.getByText(/이후 올리기는 레벨업 테스트로, 내리기는 상단 언어 메뉴에서 할 수 있어요/)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "학습 시작" });
    expect(submit).toBeDisabled();

    await user.click(radios[2]);

    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    expect(submit).toBeEnabled();
  });

  it("고른 언어·레벨만 보내고, 성공하면 /home으로 바꿔 이동한다", async () => {
    apiMock.mockResolvedValue(ok);
    const user = setup({ kind: "level", language: "en", mode: "first" });

    await user.click(screen.getByRole("radio", { name: /중급/ }));
    await user.click(screen.getByRole("button", { name: "학습 시작" }));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/levels", { language: "en", level: 3 });
    expect(replace).toHaveBeenCalledWith("/home");
    expect(screen.getByRole("button", { name: "학습 시작" })).toBeDisabled();
  });

  it("실패하면(409 포함) 서버 문구를 보여 주고 선택을 유지하며 이동하지 않는다", async () => {
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValue(pending.promise);
    const user = setup({ kind: "level", language: "ja", mode: "add" });

    await user.click(screen.getByRole("radio", { name: /초보/ }));
    await user.click(screen.getByRole("button", { name: "학습 시작" }));
    expect(screen.getByRole("button", { name: "학습 시작" })).toBeDisabled();

    pending.resolve({ ok: false, status: 409, code: "CONFLICT", message: CONFLICT_MESSAGE });

    expect(await screen.findByRole("alert")).toHaveTextContent(CONFLICT_MESSAGE);
    expect(screen.getByRole("radio", { name: /초보/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "학습 시작" })).toBeEnabled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("일본어 입문·초보 타일에만 가나 익히기 포함 태그를 단다", () => {
    setup({ kind: "level", language: "ja", mode: "first" });

    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveTextContent("가나 익히기 포함");
    expect(radios[1]).toHaveTextContent("가나 익히기 포함");
    for (const radio of radios.slice(2)) expect(radio).not.toHaveTextContent("가나 익히기 포함");
  });

  it("영어 타일에는 가나 태그가 없다", () => {
    setup({ kind: "level", language: "en", mode: "first" });

    expect(screen.queryByText("가나 익히기 포함")).toBeNull();
  });

  it("언어 추가 모드는 [취소](/home)를 두고 진행 표시와 [이전]이 없다", () => {
    setup({ kind: "level", language: "ja", mode: "add" });

    expect(screen.getByRole("link", { name: "취소" })).toHaveAttribute("href", "/home");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/\/ 3/)).toBeNull();
    expect(screen.queryByRole("button", { name: "이전" })).toBeNull();
  });
});
