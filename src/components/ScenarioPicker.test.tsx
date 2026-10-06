import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ApiResult } from "@/services/apiClient";
import { ScenarioPicker } from "./ScenarioPicker";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const push = vi.fn();
const refresh = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  push.mockReset();
  refresh.mockReset();
  vi.mocked(useRouter).mockReturnValue({ push, refresh } as unknown as ReturnType<typeof useRouter>);
});

type Item = Parameters<typeof ScenarioPicker>[0]["items"][number];

function item(overrides: Partial<Item> & Pick<Item, "scenarioId" | "index" | "title">): Item {
  return { goal: `${overrides.title} 목표`, open: null, completed: false, ...overrides };
}

const ITEMS: Item[] = [
  item({ scenarioId: "l3-a", index: 1, title: "새 상황" }),
  item({ scenarioId: "l3-b", index: 2, title: "진행 중 상황", open: { id: "s-active", status: "active", doneTurns: 4 } }),
  item({ scenarioId: "l3-c", index: 3, title: "피드백 상황", open: { id: "s-ending", status: "ending", doneTurns: 6 }, completed: true }),
  item({ scenarioId: "l3-d", index: 4, title: "끝낸 상황", completed: true }),
];

function setup(items: Item[] = ITEMS) {
  const user = userEvent.setup();
  render(<ScenarioPicker language="en" level={3} items={items} />);
  return user;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("ScenarioPicker 표시", () => {
  it("상황 번호·제목·설명을 보여 준다", () => {
    setup();

    expect(screen.getByText("상황 1")).toBeInTheDocument();
    expect(screen.getByText("새 상황")).toBeInTheDocument();
    expect(screen.getByText("새 상황 목표")).toBeInTheDocument();
    expect(screen.getByText("상황 4")).toBeInTheDocument();
  });

  it("태그는 active면 n턴 진행 중, ending이면 피드백 확인, 열린 세션 없이 완료면 완료다", () => {
    setup();

    expect(screen.getByText("4턴 진행 중")).toBeInTheDocument();
    expect(screen.getByText("피드백 확인")).toBeInTheDocument();
    // 열린 세션이 있는 완료 상황은 열린 세션 태그만 단다
    expect(screen.getAllByText("완료")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /끝낸 상황/ })).toHaveTextContent("완료");
    expect(screen.getByRole("button", { name: /새 상황/ })).not.toHaveTextContent("완료");
  });
});

describe("ScenarioPicker 열린 세션", () => {
  it("열린 세션이 있는 타일은 그 세션 링크이고 API를 부르지 않는다", async () => {
    const user = setup();

    const active = screen.getByRole("link", { name: /진행 중 상황/ });
    const ending = screen.getByRole("link", { name: /피드백 상황/ });
    expect(active).toHaveAttribute("href", "/chat/s-active");
    expect(ending).toHaveAttribute("href", "/chat/s-ending");

    // jsdom은 문서 이동을 구현하지 않으므로 기본 이동만 막고 클릭한다
    active.addEventListener("click", (e) => e.preventDefault());
    await user.click(active);

    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("ScenarioPicker 새 세션", () => {
  it("새 타일을 누르면 언어·레벨·상황으로 세션을 만들고 그 대화방으로 이동한다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { sessionId: "s-new" } });
    const user = setup();

    await user.click(screen.getByRole("button", { name: /새 상황/ }));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/chat/sessions", { language: "en", level: 3, scenario_id: "l3-a" });
    expect(push).toHaveBeenCalledWith("/chat/s-new");
  });

  it("요청 중에는 모든 타일 버튼이 비활성화된다", async () => {
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValue(pending.promise);
    const user = setup();

    await user.click(screen.getByRole("button", { name: /새 상황/ }));

    expect(screen.getByRole("button", { name: /새 상황/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /끝낸 상황/ })).toBeDisabled();
    expect(screen.getByRole("link", { name: /진행 중 상황/ })).toHaveAttribute("aria-disabled", "true");

    pending.resolve({ ok: false, status: 400, code: "INVALID_INPUT", message: "입력한 내용을 다시 확인해 주세요." });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /새 상황/ })).toBeEnabled();
    expect(screen.getByRole("link", { name: /진행 중 상황/ })).not.toHaveAttribute("aria-disabled");
  });

  it("실패하면 목록 위에 서버 문구를 보여 주고 이동하지 않는다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 400, code: "INVALID_INPUT", message: "입력한 내용을 다시 확인해 주세요." });
    const user = setup();

    await user.click(screen.getByRole("button", { name: /끝낸 상황/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("입력한 내용을 다시 확인해 주세요.");
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("409면 오류를 보여 주고 화면을 다시 읽는다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "CONFLICT", message: "레벨이 바뀌었어요." });
    const user = setup();

    await user.click(screen.getByRole("button", { name: /새 상황/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("레벨이 바뀌었어요.");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});
