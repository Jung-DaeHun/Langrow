import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ApiResult } from "@/services/apiClient";
import { ProButton } from "./ProButton";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));

const apiMock = vi.mocked(api);

beforeEach(() => {
  apiMock.mockReset();
});

function setup() {
  const user = userEvent.setup();
  render(<ProButton label="Pro 시작하기" size="sm" />);
  return user;
}

describe("ProButton", () => {
  it("라벨을 그대로 보여 주고 처음에는 모달이 없다", () => {
    setup();

    expect(screen.getByRole("button", { name: "Pro 시작하기" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("누르면 pro_clicked를 기록하고 '정식 출시 준비 중' 모달을 연다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    const user = setup();

    await user.click(screen.getByRole("button", { name: "Pro 시작하기" }));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/events", { name: "pro_clicked" });
    const modal = screen.getByRole("dialog", { name: "정식 출시 준비 중" });
    expect(modal).toHaveTextContent("Pro는 정식 출시를 준비하고 있어요. 결제 정보는 받지 않아요.");
  });

  it("기록 결과를 기다리지 않고 모달을 연다", async () => {
    apiMock.mockReturnValue(new Promise<ApiResult<unknown>>(() => {}));
    const user = setup();

    await user.click(screen.getByRole("button", { name: "Pro 시작하기" }));

    expect(screen.getByRole("dialog", { name: "정식 출시 준비 중" })).toBeInTheDocument();
  });

  it("기록에 실패해도 모달을 열고 오류를 보여 주지 않는다", async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500, code: "INTERNAL", message: "잠시 후 다시 시도해 주세요." });
    const user = setup();

    await user.click(screen.getByRole("button", { name: "Pro 시작하기" }));

    expect(screen.getByRole("dialog", { name: "정식 출시 준비 중" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("[확인]으로 닫고, 다시 누르면 한 번 더 기록한다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    const user = setup();

    await user.click(screen.getByRole("button", { name: "Pro 시작하기" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확인" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Pro 시작하기" }));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
