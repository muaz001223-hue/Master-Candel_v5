(() => {
  "use strict";

  const messageType = "LOCAL_WS_DEBUGGER_FRAME";
  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || NativeWebSocket.__localDebuggerPatched) return;

  function parsePayload(data) {
    if (typeof data !== "string") return { kind: typeof data, text: null, parsed: null };
    try { return { kind: "json", text: data, parsed: JSON.parse(data) }; }
    catch { return { kind: "text", text: data, parsed: null }; }
  }

  function emit(direction, url, data) {
    window.postMessage({
      type: messageType,
      payload: {
        direction,
        url,
        receivedAt: new Date().toISOString(),
        payload: parsePayload(data)
      }
    }, "*");
  }

  class DebugWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      this.addEventListener("message", (event) => {
        try { emit("incoming", String(url), event.data); } catch { /* passive observer */ }
      });
    }

    send(data) {
      try { emit("outgoing", String(this.url), data); } catch { /* passive observer */ }
      return super.send(data);
    }
  }

  Object.defineProperty(DebugWebSocket, "__localDebuggerPatched", { value: true });
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    Object.defineProperty(DebugWebSocket, key, { value: NativeWebSocket[key], enumerable: true });
  }
  window.WebSocket = DebugWebSocket;
})();
