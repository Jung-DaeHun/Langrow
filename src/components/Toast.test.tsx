import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showToast, ToastHost } from "./Toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("showToast는 role=status 안에 메시지를 띄우고 2.4초 뒤 지운다", () => {
    render(<ToastHost />);

    act(() => showToast("레벨을 내렸어요"));
    expect(screen.getByRole("status")).toHaveTextContent("레벨을 내렸어요");

    act(() => vi.advanceTimersByTime(2399));
    expect(screen.getByRole("status")).toHaveTextContent("레벨을 내렸어요");

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("새 메시지는 이전 것을 바꾸고 2.4초를 다시 센다", () => {
    render(<ToastHost />);

    act(() => showToast("첫 번째"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => showToast("두 번째"));

    expect(screen.getByRole("status")).toHaveTextContent("두 번째");
    expect(screen.queryByText("첫 번째")).toBeNull();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status")).toHaveTextContent("두 번째");

    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("같은 메시지를 다시 띄워도 2.4초를 다시 센다", () => {
    render(<ToastHost />);

    act(() => showToast("저장했어요"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => showToast("저장했어요"));
    act(() => vi.advanceTimersByTime(2000));

    expect(screen.getByRole("status")).toHaveTextContent("저장했어요");
  });

  it("부른 컴포넌트가 곧바로 사라져도 토스트는 남는다", () => {
    render(<ToastHost />);
    const caller = render(<p>체험 버튼</p>);

    act(() => {
      showToast("7일 Pro 체험을 시작했어요");
      caller.unmount();
    });

    expect(screen.getByRole("status")).toHaveTextContent("7일 Pro 체험을 시작했어요");
  });

  it("토스트는 house 면의 pill로 탭바 위(bottom-24)에 띄운다", () => {
    render(<ToastHost />);

    act(() => showToast("레벨을 내렸어요"));

    expect(screen.getByText("레벨을 내렸어요")).toHaveClass("rounded-full", "bg-house", "text-white", "shadow-overlay");
    expect(screen.getByRole("status")).toHaveClass("bottom-24");
  });
});
