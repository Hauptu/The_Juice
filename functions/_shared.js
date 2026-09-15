export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function withCors(headers = {}) {
  return {
    "access-control-allow-origin": "*",
    ...headers,
  };
}
