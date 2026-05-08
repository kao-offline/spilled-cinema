const REQUEST_TYPE = "SPILLEDCINEMA_EXTENSION_REQUEST";
const RESPONSE_TYPE = "SPILLEDCINEMA_EXTENSION_RESPONSE";

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== REQUEST_TYPE) {
    return;
  }

  chrome.runtime.sendMessage(
    {
      namespace: "spilledcinema",
      action: event.data.action,
      path: event.data.path,
      method: event.data.method,
      headers: event.data.headers,
      body: event.data.body,
    },
    (response) => {
      const runtimeError = chrome.runtime.lastError;
      window.postMessage(
        {
          type: RESPONSE_TYPE,
          id: event.data.id,
          ok: Boolean(response?.ok) && !runtimeError,
          payload: response?.payload ?? null,
          error: runtimeError?.message ?? response?.error ?? "Extension request failed.",
        },
        "*",
      );
    },
  );
});
