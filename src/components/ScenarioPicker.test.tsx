import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findScenario, scenarioGroups } from "@/lib/scenarios";
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

type Access = Parameters<typeof ScenarioPicker>[0]["access"];

// 지금 레벨은 중급(3). 중급 상황: 1 약국(새), 2 주말(진행 중), 3 반품(피드백 확인 + 완료),
// 4 예약(Pro, 완료), 5 병원(Pro), 6 택배(Pro, 체험 중 시작한 세션), 7 분실물(Pro)
const OPEN: Parameters<typeof scenarioGroups>[1] = [
  { id: "s-active", scenarioId: "l3-weekend", status: "active", doneTurns: 4 },
  { id: "s-ending", scenarioId: "l3-return", status: "ending", doneTurns: 6 },
  { id: "s-pro", scenarioId: "l3-package", status: "active", doneTurns: 2 },
];
const ENDED = ["l3-return", "l3-reservation"];

function title(id: string): string {
  const scenario = findScenario(id);
  if (!scenario) throw new Error(`${id} 상황이 없다`);
  return scenario.title;
}

// 접근 이름에 상황 제목이 들어간 타일
function tile(id: string, role: "button" | "link" = "button") {
  return screen.getByRole(role, { name: (name) => name.includes(title(id)) });
}

function header(levelName: string) {
  return screen.getByRole("button", { name: (name) => name.startsWith(levelName) && name.includes("상황 7개") });
}

function panel(levelName: string) {
  const el = document.getElementById(header(levelName).getAttribute("aria-controls") ?? "");
  if (el === null) throw new Error(`${levelName} 묶음 내용이 없다`);
  return el;
}

function setup(access: Access = "pro") {
  const user = userEvent.setup();
  render(<ScenarioPicker language="en" level={3} groups={scenarioGroups(3, OPEN, ENDED)} access={access} />);
  return user;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("ScenarioPicker 레벨 묶음", () => {
  it("입문 → 고수 묶음 5개이고 처음에는 지금 레벨 묶음만 펼친다", () => {
    setup();

    const headers = screen.getAllByRole("button", { name: /상황 7개/ });
    expect(headers.map((h) => h.textContent?.slice(0, 2))).toEqual(["입문", "초보", "중급", "상급", "고수"]);
    expect(headers.map((h) => h.getAttribute("aria-expanded"))).toEqual(["false", "false", "true", "false", "false"]);
    expect(header("중급")).toHaveTextContent("지금 레벨");
    expect(header("초보")).not.toHaveTextContent("지금 레벨");
    expect(within(panel("중급")).getAllByRole("button").length + within(panel("중급")).getAllByRole("link").length).toBe(7);
    expect(screen.queryByRole("button", { name: (name) => name.includes(title("l1-greeting")) })).toBeNull();
  });

  it("다른 묶음을 따로 펼치고 접는다", async () => {
    const user = setup();

    await user.click(header("입문"));
    expect(header("입문")).toHaveAttribute("aria-expanded", "true");
    expect(header("중급")).toHaveAttribute("aria-expanded", "true");
    expect(tile("l1-greeting")).toBeInTheDocument();

    await user.click(header("입문"));
    expect(header("입문")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: (name) => name.includes(title("l1-greeting")) })).toBeNull();

    await user.click(header("중급"));
    expect(header("중급")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: (name) => name.includes(title("l3-pharmacy")) })).toBeNull();
  });

  it("지금 레벨이 바뀌어 다시 그리면 새 지금 레벨 묶음만 펼친다", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ScenarioPicker language="en" level={3} groups={scenarioGroups(3, [], [])} access="pro" />);
    await user.click(header("입문"));

    rerender(<ScenarioPicker language="en" level={2} groups={scenarioGroups(2, [], [])} access="pro" />);

    const headers = screen.getAllByRole("button", { name: /상황 7개/ });
    expect(headers.map((h) => h.getAttribute("aria-expanded"))).toEqual(["false", "true", "false", "false", "false"]);
  });

  it("학습 언어가 바뀌어 다시 그리면 지금 레벨 묶음만 펼친 처음 상태로 돌아간다", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ScenarioPicker language="en" level={3} groups={scenarioGroups(3, [], [])} access="pro" />);
    await user.click(header("입문"));

    rerender(<ScenarioPicker language="ja" level={3} groups={scenarioGroups(3, [], [])} access="pro" />);

    const headers = screen.getAllByRole("button", { name: /상황 7개/ });
    expect(headers.map((h) => h.getAttribute("aria-expanded"))).toEqual(["false", "false", "true", "false", "false"]);
  });

  it("위 레벨 묶음 머리에만 잠김 표시가 있다", () => {
    setup();

    expect(header("상급")).toHaveAccessibleName(/잠김/);
    expect(header("고수")).toHaveAccessibleName(/잠김/);
    expect(header("상급").querySelector("svg.lucide-lock")).not.toBeNull();
    expect(header("입문")).not.toHaveAccessibleName(/잠김/);
    expect(header("중급")).not.toHaveAccessibleName(/잠김/);
    expect(header("중급").querySelector("svg.lucide-lock")).toBeNull();
  });
});

describe("ScenarioPicker 표시", () => {
  it("상황 번호·제목·설명을 보여 준다", () => {
    setup();

    const current = within(panel("중급"));
    expect(current.getByText("상황 1")).toBeInTheDocument();
    expect(current.getByText(title("l3-pharmacy"))).toBeInTheDocument();
    expect(current.getByText(findScenario("l3-pharmacy")?.goal ?? "")).toBeInTheDocument();
    expect(current.getByText("상황 7")).toBeInTheDocument();
  });

  it("태그는 active면 n턴 진행 중, ending이면 피드백 확인, 열린 세션 없이 완료면 완료다", () => {
    setup();

    const current = within(panel("중급"));
    expect(current.getByText("4턴 진행 중")).toBeInTheDocument();
    expect(current.getByText("피드백 확인")).toBeInTheDocument();
    // 열린 세션이 있는 완료 상황은 열린 세션 태그만 단다
    expect(current.getAllByText("완료")).toHaveLength(1);
    expect(tile("l3-reservation")).toHaveTextContent("완료");
    expect(tile("l3-pharmacy")).not.toHaveTextContent("완료");
  });

  it("Pro 상황(4~7번째)에 골드 Pro 태그를 상태 태그 뒤에 달고, 접근 이름에 Pro가 들어간다", () => {
    setup("pro");

    for (const id of ["l3-reservation", "l3-clinic", "l3-lost-item"]) {
      expect(tile(id)).toHaveAccessibleName(/Pro/);
      expect(within(tile(id)).getByText("Pro")).toHaveClass("bg-gold-wash", "text-on-gold");
    }
    expect(tile("l3-package", "link")).toHaveAccessibleName(/Pro/);
    expect(tile("l3-reservation")).toHaveTextContent(/완료.*Pro/);
    expect(tile("l3-pharmacy")).not.toHaveAccessibleName(/Pro/);
  });

  it("체험·Pro 사용자에게는 자물쇠 없는 Pro 태그를 단다", () => {
    setup("pro");

    expect(within(tile("l3-clinic")).getByText("Pro").querySelector("svg")).toBeNull();
    expect(tile("l3-clinic")).not.toHaveAccessibleName(/잠김/);
  });

  it.each<Access>(["trial-available", "trial-ended"])("Free(%s)에게는 Pro 태그 안에 자물쇠를 함께 두고 잠김을 알린다", (access) => {
    setup(access);

    expect(within(tile("l3-clinic")).getByText("Pro").querySelector("svg.lucide-lock")).not.toBeNull();
    expect(tile("l3-clinic")).toHaveAccessibleName(/Pro.*잠김/);
    expect(tile("l3-pharmacy")).not.toHaveAccessibleName(/잠김/);
  });

  it("위 레벨 상황도 제목·설명을 보여 주고, 태그 자리 끝에 자물쇠를 두고 잠김을 알린다", async () => {
    const user = setup("pro");

    await user.click(header("상급"));

    const locked = tile("l4-interview");
    expect(locked).toHaveTextContent(findScenario("l4-interview")?.goal ?? "");
    expect(locked).toHaveAccessibleName(/잠김/);
    expect(locked.querySelector("svg.lucide-lock")).not.toBeNull();
    expect(tile("l3-pharmacy").querySelector("svg.lucide-lock")).toBeNull();
  });
});

describe("ScenarioPicker 열린 세션", () => {
  it("열린 세션이 있는 타일은 그 세션 링크이고 API를 부르지 않는다", async () => {
    const user = setup();

    const active = tile("l3-weekend", "link");
    const ending = tile("l3-return", "link");
    expect(active).toHaveAttribute("href", "/chat/s-active");
    expect(ending).toHaveAttribute("href", "/chat/s-ending");

    // jsdom은 문서 이동을 구현하지 않으므로 기본 이동만 막고 클릭한다
    active.addEventListener("click", (e) => e.preventDefault());
    await user.click(active);

    expect(apiMock).not.toHaveBeenCalled();
  });

  it("열린 세션이 있는 Pro 상황은 체험이 끝났어도 그 세션 링크이고 안내를 띄우지 않는다", async () => {
    const user = setup("trial-ended");

    const link = tile("l3-package", "link");
    expect(link).toHaveAttribute("href", "/chat/s-pro");
    link.addEventListener("click", (e) => e.preventDefault());
    await user.click(link);

    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ScenarioPicker 위 레벨 상황", () => {
  it("누르면 레벨업 모달과 /level-up 링크를 보여 주고 API를 부르지 않는다", async () => {
    const user = setup("pro");

    await user.click(header("상급"));
    await user.click(tile("l4-interview"));

    const modal = screen.getByRole("dialog", { name: "레벨업 테스트에 합격하면 열려요" });
    expect(modal).toHaveTextContent("지금 레벨보다 높은 상황이에요. 레벨업 테스트로 한 단계씩 올릴 수 있어요.");
    expect(within(modal).getByRole("link", { name: "레벨업 테스트 하기" })).toHaveAttribute("href", "/level-up");
    expect(apiMock).not.toHaveBeenCalled();

    // 오른쪽 위 닫기(X)와 [닫기] 버튼 중 [닫기]
    const close = within(modal).getAllByRole("button", { name: "닫기" });
    await user.click(close[close.length - 1]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Free 사용자의 위 레벨 Pro 상황도 레벨업 모달이다", async () => {
    const user = setup("trial-available");

    await user.click(header("상급"));
    await user.click(tile("l4-lease"));

    expect(screen.getByRole("dialog", { name: "레벨업 테스트에 합격하면 열려요" })).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("ScenarioPicker Free의 Pro 상황", () => {
  it("체험 가능이면 체험 모달을 띄우고 세션 API를 부르지 않는다", async () => {
    const user = setup("trial-available");

    await user.click(tile("l3-clinic"));

    const modal = screen.getByRole("dialog", { name: "Pro 상황이에요" });
    expect(modal).toHaveTextContent(
      "Pro는 레벨마다 상황 7개를 모두 할 수 있어요. 7일 무료 체험으로 써 보세요. 결제 정보는 받지 않아요.",
    );
    expect(within(modal).getByRole("button", { name: "7일 무료 체험" })).toBeInTheDocument();
    expect(within(modal).getAllByRole("button", { name: "닫기" })).toHaveLength(2);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("체험을 시작하면 모달을 닫고 세션은 만들지 않는다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { proUntil: "2026-10-25T00:00:00.000Z" } });
    const user = setup("trial-available");

    await user.click(tile("l3-clinic"));
    await user.click(screen.getByRole("button", { name: "7일 무료 체험" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith("POST", "/api/trial");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("체험을 썼으면 pro_clicked를 남기고 '정식 출시 준비 중' 모달을 띄우며 세션 API를 부르지 않는다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    const user = setup("trial-ended");

    await user.click(tile("l3-clinic"));

    expect(screen.getByRole("dialog", { name: "정식 출시 준비 중" })).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith("POST", "/api/events", { name: "pro_clicked" });
  });
});

describe("ScenarioPicker 새 세션", () => {
  it("Free 상황을 누르면 언어·지금 레벨·상황으로 세션을 만들고 그 대화방으로 이동한다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { sessionId: "s-new" } });
    const user = setup("trial-ended");

    await user.click(tile("l3-pharmacy"));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/chat/sessions", { language: "en", level: 3, scenario_id: "l3-pharmacy" });
    expect(push).toHaveBeenCalledWith("/chat/s-new");
  });

  it("체험·Pro 사용자가 Pro 상황을 누르면 지금 레벨로 세션을 만든다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { sessionId: "s-new" } });
    const user = setup("pro");

    await user.click(tile("l3-clinic"));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/chat/sessions", { language: "en", level: 3, scenario_id: "l3-clinic" });
    expect(push).toHaveBeenCalledWith("/chat/s-new");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("아래 레벨 상황도 요청 level은 상황 레벨이 아니라 지금 레벨이다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { sessionId: "s-new" } });
    const user = setup("trial-ended");

    await user.click(header("입문"));
    await user.click(tile("l1-cafe"));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/chat/sessions", { language: "en", level: 3, scenario_id: "l1-cafe" });
  });

  it("요청 중에는 모든 타일 버튼이 비활성화된다", async () => {
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValue(pending.promise);
    const user = setup();

    await user.click(tile("l3-pharmacy"));

    expect(tile("l3-pharmacy")).toBeDisabled();
    expect(tile("l3-reservation")).toBeDisabled();
    expect(tile("l3-weekend", "link")).toHaveAttribute("aria-disabled", "true");

    pending.resolve({ ok: false, status: 400, code: "INVALID_INPUT", message: "입력한 내용을 다시 확인해 주세요." });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(tile("l3-pharmacy")).toBeEnabled();
    expect(tile("l3-weekend", "link")).not.toHaveAttribute("aria-disabled");
  });

  it("실패하면 목록 위에 서버 문구를 보여 주고 이동하지 않는다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 400, code: "INVALID_INPUT", message: "입력한 내용을 다시 확인해 주세요." });
    const user = setup();

    await user.click(tile("l3-reservation"));

    expect(await screen.findByRole("alert")).toHaveTextContent("입력한 내용을 다시 확인해 주세요.");
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("409면 오류를 보여 주고 화면을 다시 읽는다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "CONFLICT", message: "레벨이 바뀌었어요." });
    const user = setup();

    await user.click(tile("l3-pharmacy"));

    expect(await screen.findByRole("alert")).toHaveTextContent("레벨이 바뀌었어요.");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("409 뒤 바뀐 레벨로 다시 그려도 오류 안내는 남고 새 지금 레벨 묶음을 펼친다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "CONFLICT", message: "레벨이 바뀌었어요." });
    const user = userEvent.setup();
    const { rerender } = render(<ScenarioPicker language="en" level={3} groups={scenarioGroups(3, [], [])} access="pro" />);
    await user.click(tile("l3-pharmacy"));
    await screen.findByRole("alert");

    rerender(<ScenarioPicker language="en" level={2} groups={scenarioGroups(2, [], [])} access="pro" />);

    expect(screen.getByRole("alert")).toHaveTextContent("레벨이 바뀌었어요.");
    expect(header("초보")).toHaveAttribute("aria-expanded", "true");
    expect(header("중급")).toHaveAttribute("aria-expanded", "false");
  });

  it("PRO_REQUIRED(화면을 연 뒤 체험이 끝남)면 화면을 다시 읽고 준비 중 모달을 띄우며 오류 안내는 없다", async () => {
    apiMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      code: "PRO_REQUIRED",
      message: "Pro 상황은 7일 무료 체험이나 Pro에서 할 수 있어요.",
    });
    apiMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    const user = setup("pro");

    await user.click(tile("l3-clinic"));

    expect(await screen.findByRole("dialog", { name: "정식 출시 준비 중" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenLastCalledWith("POST", "/api/events", { name: "pro_clicked" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(tile("l3-pharmacy")).toBeEnabled();
  });
});
