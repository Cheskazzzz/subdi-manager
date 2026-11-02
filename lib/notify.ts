// Browser-side helper for calling /api/notify. Admin actions pass the signed-in session's access token.
export type NotifyResult = { ok: boolean; status: number; data: Record<string, any> | null };

export async function notifyApi(body: Record<string, unknown>, accessToken?: string): Promise<NotifyResult> {
  try {
    const response = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
    });
    let data: Record<string, any> | null = null;
    try { data = await response.json(); } catch { /* empty body */ }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
