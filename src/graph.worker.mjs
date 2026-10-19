import wasmUrl from "./generated/graph.wasm?url";
import { createKernel } from "../core/graph-kernel.mjs";
import { createSimulationLoop } from "../core/graph-loop.mjs";
const loop = createSimulationLoop({
  bytes: fetch(wasmUrl).then((response) => {
    if (!response.ok) throw new Error(`Graph kernel: ${response.status}`);
    return response.arrayBuffer();
  }),
  createKernel,
  send: (message, transfer) => postMessage(message, transfer),
});
self.onmessage = (event) => { void loop.receive(event.data); };
