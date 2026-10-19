import { DEFAULT_FORCES } from "./graph-kernel.mjs";
// The Worker owns the kernel and two transferable frame buffers. No queued frames
// can accumulate while the UI is busy, because a returned buffer gates each step.
export function createSimulationLoop({ bytes, createKernel, send, schedule = (fn) => setTimeout(fn, 16), cancel = clearTimeout }) {
  let epoch = -1, kernel = null, timer = null, paused = false, dead = false;
  let alpha = 0, settings = { ...DEFAULT_FORCES }, buffers = [], inFlight = 0;
  const pendingPins = new Map();
  const stop = () => { if (timer !== null) cancel(timer); timer = null; };
  const fail = (error) => { stop(); alpha = 0; send({ type: "error", epoch, message: error.message }); };
  const wake = () => {
    if (!dead && kernel && !paused && alpha >= 0.003 && buffers.length && timer === null) timer = schedule(tick);
  };
  const tick = () => {
    timer = null;
    try {
      kernel.step(alpha, settings); alpha *= 0.97;
      const buffer = buffers.pop(); new Float32Array(buffer).set(kernel.positions());
      inFlight++;
      send({ type: "frame", epoch, buffer, settled: alpha < 0.003 }, [buffer]);
      wake();
    } catch (error) { fail(error); }
  };
  return {
    async receive(message) {
      if (dead) return;
      if (message.type === "graph") {
        if (message.epoch <= epoch) return;
        epoch = message.epoch; stop(); kernel?.dispose(); kernel = null;
        buffers = []; inFlight = 0; pendingPins.clear(); alpha = 0.3; paused = !!message.paused;
        settings = { ...DEFAULT_FORCES, ...message.settings };
        if (!message.positions.length) { alpha = 0; return; }
        const installing = epoch;
        try {
          const next = await createKernel(await bytes, message);
          if (dead || installing !== epoch) { next.dispose(); return; }
          kernel = next;
          for (const [index, [x, y]] of pendingPins) kernel.pin(index, x, y);
          pendingPins.clear();
          buffers = [new ArrayBuffer(message.positions.byteLength), new ArrayBuffer(message.positions.byteLength)];
          wake();
        } catch (error) { if (!dead && installing === epoch) fail(error); }
        return;
      }
      if (message.epoch !== epoch) return;
      try {
        switch (message.type) {
          case "settings": settings = { ...settings, ...message.settings }; alpha = 0.3; break;
          case "pin":
            if (kernel) kernel.pin(message.index, message.x, message.y);
            else pendingPins.set(message.index, [message.x, message.y]);
            alpha = 0.3; break;
          case "unpin": pendingPins.delete(message.index); kernel?.unpin(message.index); alpha = 0.3; break;
          case "pause": paused = true; stop(); break;
          case "resume": paused = false; break;
          case "recycle":
            if (kernel && inFlight > 0 && message.buffer.byteLength === kernel.positions().byteLength) { buffers.push(message.buffer); inFlight--; }
            break;
        }
        wake();
      } catch (error) { fail(error); }
    },
    destroy() { dead = true; stop(); kernel?.dispose(); kernel = null; buffers = []; pendingPins.clear(); },
  };
}
