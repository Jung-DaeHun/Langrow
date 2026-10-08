import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ApiResult } from "@/services/apiClient";
import { ToastHost } from "./Toast";
import { TrialButton } from "./TrialButton";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const refresh = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  refresh.mockReset();
  vi.mocked(useRouter).mockReturnValue({ refresh } as unknown as ReturnType<typeof useRouter>);
});

function setup(onStarted?: () => void) {
  const user = userEvent.setup();
  render(
    <>
      <TrialButton label="7일 무료 체험" size="sm" onStarted={onStarted} />
      <ToastHost />
    </>,
  );
  return user;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("TrialButton", () => {
  it("라벨을 그대로 보여 준다", () => {
    setup();

    expect(screen.getByRole("button", { name: "7일 무료 체험" })).toBeEnabled();
  });

  it("누르면 체험 API를 부르고, 성공하면 토스트 → 새로 읽기 → onStarted 순서로 처리한다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { proUntil: "2026-10-13T13:00:00.000Z" } });
    const onStarted = vi.fn();
    const user = setup(onStarted);

    await user.click(screen.getByRole("button", { name: "7일 무료 체험" }));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/trial");
    expect(screen.getByRole("status")).toHaveTextContent("7일 Pro 체험을 시작했어요");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(onStarted.mock.invocationCallOrder[0]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("실패하면(이미 사용한 409 포함) 버튼 아래에 서버 문구를 오류로 보여 주고 성공 처리를 하지 않는다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409, code: "CONFLICT", message: "다른 요청과 겹쳤어요." });
    const onStarted = vi.fn();
    const user = setup(onStarted);

    await user.click(screen.getByRole("button", { name: "7일 무료 체험" }));

    expect(screen.getByRole("alert")).toHaveTextContent("다른 요청과 겹쳤어요.");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(refresh).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "7일 무료 체험" })).toBeEnabled();
  });

  it("다시 누르면 이전 오류를 지운다", async () => {
    apiMock.mockResolvedValueOnce({ ok: false, status: null, code: "NETWORK", message: "연결이 끊겼어요." });
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValueOnce(pending.promise);
    const user = setup();

    await user.click(screen.getByRole("button", { name: "7일 무료 체험" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "7일 무료 체험" }));

    expect(screen.queryByRole("alert")).toBeNull();
    pending.resolve({ ok: true, status: 200, data: { proUntil: "2026-10-13T13:00:00.000Z" } });
  });

  it("요청 중에는 비활성화하고 라벨을 '시작하는 중…'으로 바꾼다", async () => {
    const pending = deferred<ApiResult<unknown>>();
    apiMock.mockReturnValue(pending.promise);
    const user = setup();
    const button = screen.getByRole("button", { name: "7일 무료 체험" });

    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("시작하는 중…");
    await user.click(button);

    expect(apiMock).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, status: 200, data: { proUntil: "2026-10-13T13:00:00.000Z" } });
  });

  it("tone outline이면 outline 버튼이다 (기본은 primary)", () => {
    render(
      <>
        <TrialButton label="체험 A" size="sm" />
        <TrialButton label="체험 B" size="sm" tone="outline" />
      </>,
    );

    expect(screen.getByRole("button", { name: "체험 A" })).toHaveClass("bg-accent");
    const outline = screen.getByRole("button", { name: "체험 B" });
    expect(outline).toHaveClass("border-accent", "text-accent");
    expect(outline).not.toHaveClass("bg-accent");
  });
});
