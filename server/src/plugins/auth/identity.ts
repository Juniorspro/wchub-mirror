// 从 join options 取 {token, gameId} 并解析当前用户身份。
// decodeIdentity 同步、decode-only（供同步契约 addPlayer 调用）；
// verifyToken 异步验签，仅当配置了 AUTH_ACCESS_SECRET 才有意义（可选硬化）。
import { decodeCurrentUser, parseCurrentUser, AuthError } from "./jwt";

export interface Identity {
  userID: number;
  userName: string;
  token: string;
  gameId: number;
}

/** AUTH_ACCESS_SECRET 支持逗号分隔的多 secret：current,transition... */
function readSecrets(): string[] {
  const s = process.env.AUTH_ACCESS_SECRET;
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

/** 同步、decode-only：从 join opts 取身份。缺 token/非法 gameId → null。 */
export function decodeIdentity(opts: unknown): Identity | null {
  if (!opts || typeof opts !== "object") return null;
  const o = opts as Record<string, unknown>;
  const token = typeof o.token === "string" ? o.token : "";
  // 兼容 Rezona App rezonaBridge 返回字符串 gameId（getGameId.data.gameId 是 string）
  const gameId = typeof o.gameId === "number" ? o.gameId : Number(o.gameId);
  if (!token || !Number.isInteger(gameId) || gameId <= 0) return null;
  try {
    const u = decodeCurrentUser(token);
    return { userID: u.userID, userName: u.userName, token, gameId };
  } catch (err) {
    if (err instanceof AuthError) {
      console.warn(`[auth] decodeIdentity failed: ${err.code} ${err.message}`);
    } else {
      console.warn(`[auth] decodeIdentity error:`, err);
    }
    return null;
  }
}

/** 可选验签：未配置 secret 时返回 true（视为不验签放行）；配置了则验签，失败 false。 */
export async function verifyToken(token: string): Promise<boolean> {
  const secrets = readSecrets();
  if (secrets.length === 0) return true;
  try {
    await parseCurrentUser(token, secrets);
    return true;
  } catch {
    return false;
  }
}
