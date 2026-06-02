// 从 HTTP header 取 Bearer token 并解析出当前用户（UID + 用户名）。
// 对齐 go-rezona 后端 utils.GenerateToken 写入的 JWT 格式：
//   alg=HS256, claims: user_id(数字) / user_name(新) / userName(旧兼容) / exp / iat
import { jwtVerify, decodeJwt, type JWTPayload } from "jose";

interface RezonaJWTPayload extends JWTPayload {
  user_id?: number;
  user_name?: string;
  userName?: string;
}

export interface CurrentUser {
  userID: number;
  userName: string;
  /** 是否已通过签名验证。decode-only 时为 false。 */
  verified: boolean;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "malformed" | "invalid" | "no_uid",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** 从 Authorization header 取出 Bearer token 本体 */
export function extractBearerToken(authorization: string | null | undefined): string {
  if (!authorization) {
    throw new AuthError("missing Authorization header", "missing");
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) {
    throw new AuthError("Authorization header is not a Bearer token", "malformed");
  }
  return match[1].trim();
}

/** 从已解出的 payload 中归一化出 CurrentUser */
function toCurrentUser(payload: RezonaJWTPayload, verified: boolean): CurrentUser {
  const rawUID = payload.user_id;
  const userID = typeof rawUID === "number" ? rawUID : Number(rawUID);
  if (!Number.isInteger(userID) || userID <= 0) {
    throw new AuthError("token has no valid user_id", "no_uid");
  }
  return {
    userID,
    userName: payload.user_name ?? payload.userName ?? "",
    verified,
  };
}

/**
 * 验证签名并解析当前用户（生产用）。
 * @param secrets 一个或多个 HS256 secret —— 第一个是当前 secret，
 *                后续为 transition 旧 secret（对应 Go 的 WithJwtTransition）。
 */
export async function parseCurrentUser(
  token: string,
  secrets: string[],
): Promise<CurrentUser> {
  if (secrets.length === 0) {
    throw new AuthError("no signing secret configured", "invalid");
  }
  let lastErr: unknown;
  for (const secret of secrets) {
    try {
      const key = new TextEncoder().encode(secret);
      const { payload } = await jwtVerify<RezonaJWTPayload>(token, key, {
        algorithms: ["HS256"], // 锁定算法，防 alg 混淆攻击
      });
      return toCurrentUser(payload, true);
    } catch (err) {
      if (err instanceof AuthError) throw err; // no_uid 直接抛
      lastErr = err;
    }
  }
  throw new AuthError(
    `token verification failed: ${(lastErr as Error)?.message ?? "unknown"}`,
    "invalid",
  );
}

/**
 * 仅解码、不验签（无 secret 时用，或纯 UI 展示用）。
 * ⚠️ 不校验签名，不可用于鉴权决策。
 */
export function decodeCurrentUser(token: string): CurrentUser {
  const payload = decodeJwt(token) as RezonaJWTPayload;
  return toCurrentUser(payload, false);
}

/** 一步到位：从 header 取 token 并验证解析 */
export async function currentUserFromHeader(
  authorization: string | null | undefined,
  secrets: string[],
): Promise<CurrentUser> {
  return parseCurrentUser(extractBearerToken(authorization), secrets);
}

/** 一步到位：从 header 取 token 并仅解码（不验签） */
export function decodeUserFromHeader(
  authorization: string | null | undefined,
): CurrentUser {
  return decodeCurrentUser(extractBearerToken(authorization));
}
