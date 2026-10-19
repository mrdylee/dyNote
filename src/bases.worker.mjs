import { evaluateBase } from "../core/bases.mjs";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      ok: true,
      value: evaluateBase(data.source, data.notes, data.view, data.path),
    });
  } catch (e) {
    self.postMessage({ ok: false, error: e.message });
  }
};
