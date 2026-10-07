import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/apiClient";
import { LimitNotice } from "./LimitNotice";

vi.mock("@/services/apiClient", () => ({ api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const apiMock = vi.mocked(api);
const refresh = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  refresh.mockReset();
  vi.mocked(useRouter).mockReturnValue({ refresh } as unknown as ReturnType<typeof useRouter>);
});

const PRO_TEXT = "Pro는 하루 대화 150턴, 새 단어 30개까지 할 수 있어요. 결제 정보는 받지 않아요.";

describe("LimitNotice 체험 가능", () => {
  it("대화 한도 제목, Pro 한도 설명, [7일 무료 체험]·[내일 할게요]를 보여 준다", () => {
    render(<LimitNotice feature="chat" trial={{ kind: "available" }} />);

    expect(screen.getByText("오늘 AI 대화 턴을 모두 썼어요")).toBeInTheDocument();
    expect(screen.getByText(PRO_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7일 무료 체험" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "내일 할게요" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pro 시작하기" })).toBeNull();
  });

  it("단어 한도면 단어 제목을 쓴다", () => {
    render(<LimitNotice feature="words" trial={{ kind: "available" }} />);

    expect(screen.getByText("오늘 새 단어를 모두 썼어요")).toBeInTheDocument();
  });

  it("두 한도에 모두 닿았으면 안내 하나에 두 기능을 함께 적는다 (primary는 화면에 하나)", () => {
    render(<LimitNotice feature="both" trial={{ kind: "available" }} />);

    expect(screen.getByText("오늘 AI 대화 턴과 새 단어를 모두 썼어요")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "7일 무료 체험" })).toHaveLength(1);
  });

  it("체험을 시작하면 onTrialStarted를 부른다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: { proUntil: "2026-10-13T13:00:00.000Z" } });
    const onTrialStarted = vi.fn();
    const user = userEvent.setup();
    render(<LimitNotice feature="chat" trial={{ kind: "available" }} onTrialStarted={onTrialStarted} />);

    await user.click(screen.getByRole("button", { name: "7일 무료 체험" }));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/trial");
    expect(onTrialStarted).toHaveBeenCalledTimes(1);
  });

  it("[내일 할게요]는 onLater가 있으면 그것을 부르고 안내는 그대로 둔다", async () => {
    const onLater = vi.fn();
    const user = userEvent.setup();
    render(<LimitNotice feature="words" trial={{ kind: "available" }} onLater={onLater} />);

    await user.click(screen.getByRole("button", { name: "내일 할게요" }));

    expect(onLater).toHaveBeenCalledTimes(1);
    expect(screen.getByText("오늘 새 단어를 모두 썼어요")).toBeInTheDocument();
  });

  it("[내일 할게요]는 onLater가 없으면 안내를 숨긴다", async () => {
    const user = userEvent.setup();
    render(<LimitNotice feature="chat" trial={{ kind: "available" }} />);

    await user.click(screen.getByRole("button", { name: "내일 할게요" }));

    expect(screen.queryByText("오늘 AI 대화 턴을 모두 썼어요")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("LimitNotice 체험 사용함", () => {
  it("같은 제목·설명과 [Pro 시작하기]만 보여 주고, 누르면 준비 중 모달을 연다", async () => {
    apiMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    const user = userEvent.setup();
    render(<LimitNotice feature="chat" trial={{ kind: "ended" }} />);

    expect(screen.getByText("오늘 AI 대화 턴을 모두 썼어요")).toBeInTheDocument();
    expect(screen.getByText(PRO_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "7일 무료 체험" })).toBeNull();
    expect(screen.queryByRole("button", { name: "내일 할게요" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Pro 시작하기" }));

    expect(apiMock).toHaveBeenCalledWith("POST", "/api/events", { name: "pro_clicked" });
    expect(screen.getByRole("dialog", { name: "정식 출시 준비 중" })).toBeInTheDocument();
  });
});

describe("LimitNotice 체험 중", () => {
  it("자정 안내와 계속할 수 있는 학습을 보여 주고 버튼이 없다", () => {
    render(<LimitNotice feature="words" trial={{ kind: "active", daysLeft: 3 }} />);

    expect(screen.getByText("오늘 사용량을 모두 썼어요")).toBeInTheDocument();
    expect(
      screen.getByText("한국 시간 자정에 다시 채워져요. 복습과 레벨업 테스트는 계속할 수 있어요."),
    ).toBeInTheDocument();
    expect(screen.queryByText(PRO_TEXT)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
