import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserSupabase } from "@/services/supabase/browser";
import { LogoutButton } from "./LogoutButton";

vi.mock("@/services/supabase/browser", () => ({ getBrowserSupabase: vi.fn() }));

const signOut = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  signOut.mockReset();
  assign.mockReset();
  vi.mocked(getBrowserSupabase).mockReturnValue({ auth: { signOut } } as unknown as ReturnType<
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

describe("LogoutButton", () => {
  it("누르면 로그아웃하고 성공하면 /로 이동한다", async () => {
    signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("에러가 오면 이동하지 않고 오류 안내를 보여 준다", async () => {
    signOut.mockResolvedValue({ error: new Error("auth") });
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("로그아웃하지 못했어요");
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeEnabled();
  });

  it("요청이 throw해도 오류 안내를 보여 준다", async () => {
    signOut.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(<LogoutButton />);

    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("로그아웃하지 못했어요");
  });

  it("요청 중에는 비활성화해 두 번 요청하지 않는다", async () => {
    const pending = deferred<{ error: null }>();
    signOut.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: "로그아웃" });

    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);

    expect(signOut).toHaveBeenCalledTimes(1);
    pending.resolve({ error: null });
  });
});
