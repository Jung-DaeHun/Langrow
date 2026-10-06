import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserSupabase } from "@/services/supabase/browser";
import { GoogleLoginButton } from "./GoogleLoginButton";

vi.mock("@/services/supabase/browser", () => ({ getBrowserSupabase: vi.fn() }));

const signInWithOAuth = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  signInWithOAuth.mockReset();
  assign.mockReset();
  vi.mocked(getBrowserSupabase).mockReturnValue({ auth: { signInWithOAuth } } as unknown as ReturnType<
    typeof getBrowserSupabase
  >);
  vi.stubGlobal("location", { origin: "https://langrow.example", assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("GoogleLoginButton 모양", () => {
  it("google은 G 로고와 'Google로 시작하기' 버튼이다", () => {
    render(<GoogleLoginButton variant="google" />);

    const button = screen.getByRole("button", { name: "Google로 시작하기" });
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("nav는 '로그인' 버튼이다", () => {
    render(<GoogleLoginButton variant="nav" />);

    expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
  });
});

describe("GoogleLoginButton 로그인", () => {
  it("누르면 구글 OAuth를 현재 origin의 /auth/callback으로 돌아오게 요청한다", async () => {
    signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: "https://accounts.google.com" }, error: null });
    const user = userEvent.setup();
    render(<GoogleLoginButton variant="google" />);

    await user.click(screen.getByRole("button", { name: "Google로 시작하기" }));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://langrow.example/auth/callback" },
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("진행 중과 구글로 이동하는 동안 비활성화해 두 번 요청하지 않는다", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    signInWithOAuth.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<GoogleLoginButton variant="nav" />);
    const button = screen.getByRole("button", { name: "로그인" });

    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(signInWithOAuth).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ data: {}, error: null }));
    expect(button).toBeDisabled();
  });

  it("에러가 오면 /?login=failed로 이동한다", async () => {
    signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: null }, error: new Error("oauth") });
    const user = userEvent.setup();
    render(<GoogleLoginButton variant="google" />);

    await user.click(screen.getByRole("button", { name: "Google로 시작하기" }));

    expect(assign).toHaveBeenCalledWith("/?login=failed");
  });

  it("요청이 throw해도 /?login=failed로 이동한다", async () => {
    signInWithOAuth.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<GoogleLoginButton variant="google" />);

    await user.click(screen.getByRole("button", { name: "Google로 시작하기" }));

    expect(assign).toHaveBeenCalledWith("/?login=failed");
  });

  it("구글 화면에서 뒤로 돌아오면(pageshow) 다시 누를 수 있다", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();
    render(<GoogleLoginButton variant="google" />);
    const button = screen.getByRole("button", { name: "Google로 시작하기" });
    await user.click(button);
    expect(button).toBeDisabled();

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(button).toBeEnabled();
  });
});
