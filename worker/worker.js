const UPSTREAM = "https://models.github.ai/inference/chat/completions";
const ALLOWED_ORIGIN = "https://TU-USUARIO.github.io"; // ajusta esto a tu propia URL de GitHub Pages

function withCors(resp) {
  const headers = new Headers(resp.headers);
  headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return new Response(resp.body, { status: resp.status, headers });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }
    if (request.method !== "POST") {
      return withCors(new Response("Método no permitido", { status: 405 }));
    }
    try {
      const upstreamResponse = await fetch(UPSTREAM, {
        method: "POST",
        headers: {
          Authorization: request.headers.get("Authorization") || "",
          "Content-Type": "application/json",
        },
        body: await request.text(),
      });
      return withCors(upstreamResponse);
    } catch (err) {
      return withCors(
        new Response(JSON.stringify({ error: "worker_unreachable", detail: String(err) }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  },
};
