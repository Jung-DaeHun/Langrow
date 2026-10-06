import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ApiResult } from "@/services/apiClient";
import { KanaDeck } from "./KanaDeck";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));

const apiMock = vi.mocked(api);
const scrollTo = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  scrollTo.mockReset();
  vi.stubGlobal("scrollTo", scrollTo);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const user = userEvent.setup();
  const view = render(<KanaDeck />);
  return { user, container: view.container };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ok: ApiResult<unknown> = { ok: true, status: 200, data: {} };
const KANA_BODY = { name: "kana_studied" };

type User = ReturnType<typeof userEvent.setup>;

const focusRoot = (container: HTMLElement) => container.querySelector("[data-focus-mode]");
// 카드 버튼의 이름은 보이는 면의 글자다
const card = (char: string) => screen.getByRole("button", { name: char });

async function know(user: User, times: number) {
  for (let i = 0; i < times; i++) await user.click(screen.getByRole("button", { name: "알아요" }));
}

describe("KanaDeck 행 선택", () => {
  it("히라가나 탭, 71자 전체, 기본·탁음 섹션의 행 타일을 보여 주고 집중 모드가 아니다", () => {
    const { container } = setup();

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "히라가나" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "가타카나" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: "71자 전체" })).toBeInTheDocument();

    const basic = screen.getByRole("region", { name: "기본 46자" });
    const voiced = screen.getByRole("region", { name: "탁음·반탁음 25자" });
    expect(within(basic).getAllByRole("button")).toHaveLength(10);
    expect(within(voiced).getAllByRole("button")).toHaveLength(5);
    expect(within(basic).getByRole("button", { name: /あ행 · 5자/ })).toBeInTheDocument();
    expect(within(basic).getByRole("button", { name: /や행 · 3자/ })).toBeInTheDocument();
    expect(within(voiced).getByRole("button", { name: /が행 · 5자/ })).toBeInTheDocument();
    expect(focusRoot(container)).toBeNull();
  });

  it("가타카나 탭으로 바꾸면 타일이 가타카나가 된다", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("tab", { name: "가타카나" }));

    expect(screen.getByRole("tab", { name: "가타카나" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /ア행 · 5자/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /あ행/ })).not.toBeInTheDocument();
  });
});

describe("KanaDeck 카드", () => {
  it("행을 고르면 집중 모드로 첫 글자 카드와 아는 글자 수 / 전체를 보여 준다", async () => {
    const { user, container } = setup();

    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));

    expect(focusRoot(container)).not.toBeNull();
    expect(screen.getByRole("button", { name: "행 선택" })).toBeInTheDocument();
    expect(screen.getByText("0 / 5")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "아는 글자" })).toHaveAttribute("aria-valuenow", "0");
    expect(card("あ")).toBeInTheDocument();
    // 앞면·뒷면 글자 모두
    screen.getAllByText("あ", { selector: "button span span" }).forEach((el) => expect(el).toHaveAttribute("lang", "ja"));
  });

  it("뒤집으면 로마자 · 한글 발음을 보여 준다", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));

    await user.click(card("あ"));

    expect(screen.getAllByRole("button")[1]).toHaveAccessibleName(/a · 아$/);
  });

  it("[모르겠어요]를 누른 글자는 회차 끝에 다시 나오고, 아는 글자만 센다", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));

    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    expect(card("い")).toBeInTheDocument();
    expect(screen.getByText("0 / 5")).toBeInTheDocument();

    await know(user, 4);
    expect(card("あ")).toBeInTheDocument();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("[행 선택]을 누르면 기록 없이 선택 화면으로 돌아간다", async () => {
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));
    await know(user, 2);

    await user.click(screen.getByRole("button", { name: "행 선택" }));

    expect(focusRoot(container)).toBeNull();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("가타카나 행은 가타카나 글자로 카드를 낸다", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("tab", { name: "가타카나" }));

    await user.click(screen.getByRole("button", { name: /カ행 · 5자/ }));

    expect(card("カ")).toBeInTheDocument();
  });
});

describe("KanaDeck 완료", () => {
  it("모든 글자를 알면 완료 화면과 글자 격자를 보여 주고 kana_studied를 정확히 한 번 보낸다", async () => {
    apiMock.mockResolvedValue(ok);
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));

    await user.click(screen.getByRole("button", { name: "모르겠어요" }));
    await know(user, 5);

    expect(focusRoot(container)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "あ행 5자 완료" })).toBeInTheDocument();
    expect(screen.getByText("5자를 모두 익혔어요")).toBeInTheDocument();
    const grid = screen.getByRole("list", { name: "익힌 글자" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(5);
    expect(apiMock).toHaveBeenCalledExactlyOnceWith("POST", "/api/events", KANA_BODY);
  });

  it("기록하는 동안 [한 번 더]·[다른 행]을 잠근다", async () => {
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValue(pending.promise);
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));

    await know(user, 5);

    expect(screen.getByRole("button", { name: "한 번 더" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다른 행" })).toBeDisabled();
    pending.resolve(ok);
    expect(await screen.findByRole("button", { name: "한 번 더" })).toBeEnabled();
  });

  it("기록에 실패하면 완료 화면은 두고 오류 안내와 [다시 시도]를 보여 준다", async () => {
    apiMock.mockResolvedValueOnce({ ok: false, status: null, code: "NETWORK", message: "인터넷 연결을 확인해 주세요." });
    apiMock.mockResolvedValueOnce(ok);
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));
    await know(user, 5);

    expect(await screen.findByRole("alert")).toHaveTextContent("인터넷 연결을 확인해 주세요.");
    expect(screen.getByRole("heading", { name: "あ행 5자 완료" })).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock).toHaveBeenLastCalledWith("POST", "/api/events", KANA_BODY);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "あ행 5자 완료" })).toBeInTheDocument();
  });

  it("[한 번 더]는 같은 글자로 다시 시작하고, 끝내면 다시 한 번 기록한다", async () => {
    apiMock.mockResolvedValue(ok);
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));
    await know(user, 5);

    await user.click(await screen.findByRole("button", { name: "한 번 더" }));

    expect(screen.getByText("0 / 5")).toBeInTheDocument();
    expect(card("あ")).toBeInTheDocument();
    await know(user, 5);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("[다른 행]은 선택 화면으로 돌아간다", async () => {
    apiMock.mockResolvedValue(ok);
    const { user, container } = setup();
    await user.click(screen.getByRole("button", { name: /あ행 · 5자/ }));
    await know(user, 5);

    await user.click(await screen.findByRole("button", { name: "다른 행" }));

    expect(focusRoot(container)).toBeNull();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("71자 전체는 그 문자 71자로 회차를 만들고, 완료 제목은 문자 이름이다", async () => {
    apiMock.mockResolvedValue(ok);
    const { user } = setup();
    await user.click(screen.getByRole("tab", { name: "가타카나" }));

    await user.click(screen.getByRole("button", { name: "71자 전체" }));

    expect(screen.getByText("0 / 71")).toBeInTheDocument();
    expect(card("ア")).toBeInTheDocument();
    for (let i = 0; i < 71; i++) fireEvent.click(screen.getByRole("button", { name: "알아요" }));
    expect(screen.getByRole("heading", { name: "가타카나 71자 완료" })).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledExactlyOnceWith("POST", "/api/events", KANA_BODY);
  });
});
