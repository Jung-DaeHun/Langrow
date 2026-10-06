import { ERRORS, isErrorCode, type ErrorCode } from "@/lib/errors";

// 브라우저 → /api/** 호출은 모두 이 함수로 한다(spec 6-10). 401·403 이동, 202, 네트워크 오류를 여기서 처리한다

export type ApiFailureCode = ErrorCode | "NETWORK";
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; code: ApiFailureCode; message: string };

// 503 문구("턴은 차감되지 않았어요")를 네트워크 끊김에 쓰지 않으려고 따로 둔다
export const NETWORK_MESSAGE = "연결이 끊겼어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";

const NOT_JSON = Symbol("not-json");

export async function api<T>(method: "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<ApiResult<T>> {
  let status: number;
  let text: string;
  try {
    // route() 래퍼가 JSON Content-Type을 요구하므로 body가 없는 API에도 헤더는 보낸다
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    status = res.status;
    text = await res.text();
  } catch {
    return { ok: false, status: null, code: "NETWORK", message: NETWORK_MESSAGE };
  }

  const parsed = parseJson(text);
  if (status >= 200 && status < 300 && parsed !== NOT_JSON) {
    return { ok: true, status, data: (parsed ?? {}) as T };
  }

  // 컴포넌트 밖이라 useRouter를 쓸 수 없고, 인증·준비 상태가 바뀌었으니 클라이언트 상태를 버리고 전체를 다시 불러온다
  const failure = toFailure(status, parsed);
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  if (status === 401) window.location.assign("/");
  if (failure.code === "CONSENT_REQUIRED" || failure.code === "ONBOARDING_REQUIRED") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/onboarding");
  }
  return failure;
}

function parseJson(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

// JSON이 아니거나 모르는 code(예: Vercel 타임아웃 HTML)는 INTERNAL로 본다
function toFailure(status: number, parsed: unknown): ApiResult<never> & { ok: false } {
  const body = typeof parsed === "object" && parsed !== null ? (parsed as { code?: unknown; message?: unknown }) : {};
  if (!isErrorCode(body.code)) return { ok: false, status, code: "INTERNAL", message: ERRORS.INTERNAL.message };
  const message = typeof body.message === "string" && body.message !== "" ? body.message : ERRORS[body.code].message;
  return { ok: false, status, code: body.code, message };
}
