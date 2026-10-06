import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Language, Level } from "@/lib/levels";
import { api, type ApiResult } from "@/services/apiClient";
import { LanguageSheet } from "./LanguageSheet";
import { ToastHost } from "./Toast";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const refresh = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  refresh.mockReset();
  vi.mocked(useRouter).mockReturnValue({ refresh } as unknown as ReturnType<typeof useRouter>);
});

function setup(language: Language, levels: Partial<Record<Language, Level>>) {
  const user = userEvent.setup();
  render(
    <>
      <LanguageSheet language={language} levels={levels} />
      <ToastHost />
    </>,
  );
  return user;
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /영어 · |일본어 · / }));
  return screen.getByRole("dialog", { name: "학습 언어" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("LanguageSheet 트리거", () => {
  it("현재 언어·레벨을 pill로 보여 주고 시트를 연다", async () => {
    const user = setup("en", { en: 3 });

    const trigger = screen.getByRole("button", { name: "영어 · 중급" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "학습 언어" })).toBeInTheDocument();
  });
});

describe("LanguageSheet 언어 타일", () => {
  it("LANGUAGES 순서로 radio를 두고 현재 언어에 aria-checked를 단다", async () => {
    const user = setup("ja", { en: 2, ja: 1 });
    const sheet = await openSheet(user);

    const group = within(sheet).getByRole("radiogroup");
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveTextContent("영어");
    expect(radios[0]).toHaveTextContent("레벨 2 · 초보");
    expect(radios[0]).toHaveAttribute("aria-checked", "false");
    expect(radios[1]).toHaveTextContent("일본어");
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
  });

  it("레벨이 있는 다른 언어를 누르면 언어를 바꾸고 시트를 닫은 뒤 새로 읽는다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    const user = setup("en", { en: 3, ja: 1 });
    const sheet = await openSheet(user);

    await user.click(within(sheet).getByRole("radio", { name: /일본어/ }));

    expect(apiMock).toHaveBeenCalledWith("PUT", "/api/me/language", { language: "ja" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("전환에 실패하면 시트 안에 서버 문구를 오류로 보여 주고 새로 읽지 않는다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "CONFLICT", message: "다른 요청과 겹쳤어요." });
    const user = setup("en", { en: 3, ja: 1 });
    const sheet = await openSheet(user);

    await user.click(within(sheet).getByRole("radio", { name: /일본어/ }));

    expect(within(sheet).getByRole("alert")).toHaveTextContent("다른 요청과 겹쳤어요.");
    expect(screen.getByRole("dialog", { name: "학습 언어" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("요청 중에는 버튼을 비활성화해 같은 요청을 두 번 보내지 않는다", async () => {
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValue(pending.promise);
    const user = setup("en", { en: 3, ja: 1 });
    const sheet = await openSheet(user);
    const ja = within(sheet).getByRole("radio", { name: /일본어/ });

    await user.click(ja);
    expect(ja).toBeDisabled();
    await user.click(ja);

    expect(apiMock).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, status: 200, data: {} });
  });

  it("레벨이 없는 언어는 새 언어 추가 링크다", async () => {
    const user = setup("en", { en: 3 });
    const sheet = await openSheet(user);

    const add = within(sheet).getByRole("radio", { name: /일본어/ });
    expect(add.tagName).toBe("A");
    expect(add).toHaveAttribute("href", "/onboarding?language=ja");
    expect(add).toHaveTextContent("새 언어 추가하기");
  });

  it("현재 언어를 눌러도 요청하지 않는다", async () => {
    const user = setup("en", { en: 3, ja: 1 });
    const sheet = await openSheet(user);

    await user.click(within(sheet).getByRole("radio", { name: /영어/ }));

    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("LanguageSheet 레벨 내리기", () => {
  it("레벨 1이면 레벨 내리기가 없다", async () => {
    const user = setup("en", { en: 1 });
    const sheet = await openSheet(user);

    expect(within(sheet).queryByRole("button", { name: /레벨 내리기/ })).toBeNull();
  });

  it("누르면 시트를 닫고 확인 모달을 연다", async () => {
    const user = setup("en", { en: 3 });
    const sheet = await openSheet(user);

    await user.click(within(sheet).getByRole("button", { name: "레벨 내리기 (중급 → 초보)" }));

    expect(screen.queryByRole("dialog", { name: "학습 언어" })).toBeNull();
    const modal = screen.getByRole("dialog", { name: "레벨을 내릴까요?" });
    expect(modal).toHaveTextContent("다시 올리려면 레벨업 테스트를 통과해야 해요.");
    expect(within(modal).getByRole("button", { name: "취소" })).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "내리기" })).toBeInTheDocument();
  });

  it("취소하면 모달만 닫고 요청하지 않는다", async () => {
    const user = setup("en", { en: 3 });
    await user.click(within(await openSheet(user)).getByRole("button", { name: /레벨 내리기/ }));

    await user.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("내리기는 한 단계 낮은 레벨을 보내고, 성공하면 모달을 닫고 토스트 뒤 새로 읽는다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { level: 2 } });
    const user = setup("ja", { ja: 3 });
    await user.click(within(await openSheet(user)).getByRole("button", { name: /레벨 내리기/ }));

    await user.click(screen.getByRole("button", { name: "내리기" }));

    expect(apiMock).toHaveBeenCalledWith("PATCH", "/api/levels/ja", { level: 2 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("레벨을 내렸어요");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("내리기에 실패하면 모달 안에 오류를 보여 주고 토스트를 띄우지 않는다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "CONFLICT", message: "레벨이 이미 바뀌었어요." });
    const user = setup("en", { en: 3 });
    await user.click(within(await openSheet(user)).getByRole("button", { name: /레벨 내리기/ }));

    await user.click(screen.getByRole("button", { name: "내리기" }));

    const modal = screen.getByRole("dialog", { name: "레벨을 내릴까요?" });
    expect(within(modal).getByRole("alert")).toHaveTextContent("레벨이 이미 바뀌었어요.");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("요청 중에는 [내리기]를 비활성화한다", async () => {
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValue(pending.promise);
    const user = setup("en", { en: 3 });
    await user.click(within(await openSheet(user)).getByRole("button", { name: /레벨 내리기/ }));
    const confirm = screen.getByRole("button", { name: "내리기" });

    await user.click(confirm);
    expect(confirm).toBeDisabled();
    await user.click(confirm);

    expect(apiMock).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, status: 200, data: { level: 2 } });
  });
});
