import { Application, Buffer, BufferUsage, Container, Geometry, Graphics, Mesh, Shader, Sprite, Text } from "pixi.js";
// Pixi's CSP polyfill replaces generated JavaScript with ordinary functions.
import "pixi.js/unsafe-eval";
import { graphReplayOrder } from "../core/graph.mjs";
import { screenToWorld, zoomAt, segmentVisible } from "../core/graph-camera.mjs";

export async function createGraphRenderer(container, { onOpen, onPin, onUnpin, onCamera = () => {}, onReplay = () => {} }) {
  let labelFont = getComputedStyle(container).fontFamily;
  const app = new Application();
  await app.init({ width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight), preference: "webgl", background: 0xffffff, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true, autoStart: false, sharedTicker: false, gcActive: false });
  app.stop();
  // We handle DOM input and explicitly destroy this bounded scene. Disable
  // Pixi 8.22 maintenance listeners so a settled graph schedules no RAF.
  app.renderer.events.setTargetElement(null);
  app.renderer.scheduler.destroy();
  const canvas = app.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "문서 연결 그래프. 방향키로 이동, +와 -로 확대 및 축소");
  container.appendChild(canvas);
  app.stage.eventMode = "none";
  const dots = new Container(), labels = new Container();
  const circle = new Graphics().circle(12, 12, 11).fill(0xffffff);
  const texture = app.renderer.generateTexture(circle); circle.destroy();
  app.stage.addChild(dots, labels);
  let graph = null, positions = new Float32Array(), screen = new Float32Array();
  let sprites = [], texts = [], edgeMesh = null, geometry = null, shader = null;
  let vertices = new Float32Array(), colors = new Float32Array(), positionBuffer, colorBuffer;
  let camera = { x: 0, y: 0, zoom: 1 }, display = { nodeSize: 1, lineWidth: 1, labelThreshold: 0, arrows: false };
  let nodeColors = [], replayState = null;
  let active = null, hover = -1, drag = null, frame = null, destroyed = false, autoFit = true;
  let width = app.screen.width, height = app.screen.height;
  const invalidate = () => { if (!destroyed && frame === null) frame = requestAnimationFrame(draw); };
  const cameraChanged = () => { onCamera(camera.zoom); invalidate(); };
  const destroyEdges = () => { edgeMesh?.destroy(); geometry?.destroy(true); shader?.destroy(); edgeMesh = geometry = shader = null; };
  const finishDrag = (open = false) => {
    const previous = drag; drag = null;
    if (!previous) return;
    if (previous.node >= 0) {
      onUnpin(previous.node);
      if (open && !previous.moved) onOpen(graph.nodes[previous.node].path);
    }
    if (canvas.hasPointerCapture(previous.pointer)) canvas.releasePointerCapture(previous.pointer);
  };
  function draw() {
    frame = null;
    if (destroyed || !graph) return;
    const progress = replayState ? Math.min(1, (performance.now() - replayState.start) / 4000) : 1;
    const revealed = (i) => !replayState || progress >= 1 || replayState.order[i] <= Math.floor(progress * (replayState.last + 1));
    if (replayState && progress >= 1) { replayState = null; onReplay(false); }
    const labelAlpha = Math.max(0, Math.min(1, Math.log2(camera.zoom) + 1 - display.labelThreshold));
    const end = Math.min(graph.nodes.length, sprites.length + 300);
    for (let i = sprites.length; i < end; i++) {
      const sprite = new Sprite(texture); sprite.anchor.set(0.5); dots.addChild(sprite); sprites.push(sprite);
    }
    const focus = hover >= 0 ? hover : graph.index.get(active), neighbors = graph.adjacency[focus];
    const candidates = [], selected = [];
    for (let i = 0; i < graph.nodes.length; i++) {
      const x = positions[2 * i] * camera.zoom + camera.x, y = positions[2 * i + 1] * camera.zoom + camera.y;
      screen[2 * i] = x; screen[2 * i + 1] = y;
      if (i >= sprites.length) continue;
      const sprite = sprites[i], important = i === focus || graph.nodes[i].path === active;
      const radius = Math.max(1.5, (4 + Math.min(6, Math.sqrt(graph.nodes[i].degree))) * display.nodeSize * camera.zoom);
      sprite.visible = revealed(i) && x >= -radius && y >= -radius && x <= width + radius && y <= height + radius;
      if (!sprite.visible) continue;
      sprite.position.set(x, y); sprite.width = sprite.height = radius * 2;
      sprite.tint = important ? 0x8055b3 : nodeColors[i] ?? ({ tag: 0x49a591, attachment: 0x6c9cbe, missing: 0xb6b6c0 }[graph.nodes[i].type] ?? 0xb8a6ca);
      sprite.alpha = focus !== undefined && focus >= 0 && !important && !neighbors?.has(i) ? 0.3 : 1;
      if (important) selected.push(i); else if (labelAlpha > 0) candidates.push(i);
    }
    // One indexed GPU mesh for all edges, without per-edge scene objects.
    if (geometry) {
      for (let e = 0; e < graph.links.length; e += 2) {
        const a = graph.links[e], b = graph.links[e + 1], offset = e * 7;
        const x1 = screen[2 * a], y1 = screen[2 * a + 1], x2 = screen[2 * b], y2 = screen[2 * b + 1];
        const visible = revealed(a) && revealed(b) && segmentVisible(x1, y1, x2, y2, width, height);
        const length = Math.max(0.001, Math.hypot(x2 - x1, y2 - y1));
        const nx = -(y2 - y1) / length * display.lineWidth * 0.5, ny = (x2 - x1) / length * display.lineWidth * 0.5;
        vertices[offset] = (x1 + nx) / width * 2 - 1; vertices[offset + 1] = 1 - (y1 + ny) / height * 2;
        vertices[offset + 2] = (x1 - nx) / width * 2 - 1; vertices[offset + 3] = 1 - (y1 - ny) / height * 2;
        vertices[offset + 4] = (x2 - nx) / width * 2 - 1; vertices[offset + 5] = 1 - (y2 - ny) / height * 2;
        vertices[offset + 6] = (x2 + nx) / width * 2 - 1; vertices[offset + 7] = 1 - (y2 + ny) / height * 2;
        // Arrowheads share the edge mesh: no per-link display objects.
        const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
        const radius = Math.max(1.5, (4 + Math.min(6, Math.sqrt(graph.nodes[b].degree))) * display.nodeSize * camera.zoom) + 2;
        const tipX = x2 - ux * radius, tipY = y2 - uy * radius;
        const arrowSize = Math.max(5, display.lineWidth * 3);
        const points = [tipX, tipY, tipX - ux * arrowSize - uy * arrowSize * 0.5, tipY - uy * arrowSize + ux * arrowSize * 0.5, tipX - ux * arrowSize + uy * arrowSize * 0.5, tipY - uy * arrowSize - ux * arrowSize * 0.5];
        for (let v = 0; v < 3; v++) { vertices[offset + 8 + v * 2] = points[v * 2] / width * 2 - 1; vertices[offset + 9 + v * 2] = 1 - points[v * 2 + 1] / height * 2; }
        const focused = a === focus || b === focus;
        const opacity = visible ? focused ? 0.65 : focus !== undefined && focus >= 0 ? 0.08 : 0.20 : 0;
        for (let v = 0; v < 7; v++) {
          const c = (e / 2 * 7 + v) * 4;
          const alpha = v < 4 || (display.arrows && camera.zoom >= 0.5 && length > radius * 2 + arrowSize) ? opacity : 0;
          colors[c] = 0.55 * alpha; colors[c + 1] = 0.43 * alpha; colors[c + 2] = 0.68 * alpha; colors[c + 3] = alpha;
        }
      }
      positionBuffer.update(); colorBuffer.update();
    }
    const cells = new Set(), wanted = [];
    for (const i of [...selected, ...candidates]) {
      const cell = `${Math.floor(screen[2 * i] / 120)}:${Math.floor(screen[2 * i + 1] / 30)}`;
      if (cells.has(cell) && !selected.includes(i)) continue;
      cells.add(cell); wanted.push(i);
      if (wanted.length === 150) break;
    }
    const createUntil = Math.min(wanted.length, texts.length + 8);
    while (texts.length < createUntil) {
      const text = new Text({ text: "", style: { fontFamily: labelFont, fontSize: 12, fill: 0x6b557f }, resolution: Math.min(devicePixelRatio, 2) });
      text.anchor.set(0.5, 0); labels.addChild(text); texts.push(text);
    }
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i], node = wanted[i]; text.visible = node !== undefined;
      if (!text.visible) continue;
      text.text = (graph.nodes[node].title ?? graph.nodes[node].path).slice(0, 40);
      text.position.set(screen[2 * node], screen[2 * node + 1] + Math.max(8, sprites[node].height * 0.5 + 4));
      text.alpha = selected.includes(node) ? 1 : labelAlpha;
    }
    app.render();
    if (replayState || sprites.length < graph.nodes.length || texts.length < wanted.length) invalidate();
  }
  const point = (event) => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  const hit = (p) => {
    let best = -1, nearest = Infinity;
    for (let i = 0; i < sprites.length; i++) {
      if (!sprites[i].visible) continue;
      const d = Math.hypot(p.x - screen[2 * i], p.y - screen[2 * i + 1]);
      if (d <= Math.max(7, sprites[i].width / 2 + 3) && d < nearest) { best = i; nearest = d; }
    }
    return best;
  };
  const down = (event) => {
    if (event.button !== 0 || !graph) return;
    finishDrag(); autoFit = false; canvas.focus();
    const p = point(event), node = hit(p);
    drag = { ...p, pointer: event.pointerId, node, camera: { ...camera }, moved: false };
    canvas.setPointerCapture(event.pointerId);
    if (node >= 0) onPin(node, positions[2 * node], positions[2 * node + 1]);
  };
  const move = (event) => {
    const p = point(event);
    if (drag) {
      if (drag.pointer !== event.pointerId) return;
      drag.moved ||= Math.hypot(p.x - drag.x, p.y - drag.y) >= 4;
      if (!drag.moved) return;
      if (drag.node >= 0) {
        const world = screenToWorld(p, camera);
        positions[2 * drag.node] = world.x; positions[2 * drag.node + 1] = world.y;
        onPin(drag.node, world.x, world.y); invalidate();
      } else { camera.x = drag.camera.x + p.x - drag.x; camera.y = drag.camera.y + p.y - drag.y; cameraChanged(); }
    } else {
      const next = hit(p);
      if (hover !== next) { hover = next; canvas.style.cursor = hover >= 0 ? "grab" : "default"; invalidate(); }
    }
  };
  const up = (event) => { if (event.pointerId === drag?.pointer) finishDrag(true); };
  const cancel = () => finishDrag();
  const leave = () => { if (!drag) { hover = -1; invalidate(); } };
  const zoom = (factor, p = { x: width / 2, y: height / 2 }) => { autoFit = false; camera = zoomAt(camera, p, factor); cameraChanged(); };
  const wheel = (event) => { event.preventDefault(); zoom(Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.03 : 0.0015)), point(event)); };
  const key = (event) => {
    const direction = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
    if (direction) { event.preventDefault(); autoFit = false; camera.x += direction[0]; camera.y += direction[1]; cameraChanged(); }
    else if (["+", "=", "-"].includes(event.key)) { event.preventDefault(); zoom(event.key === "-" ? 0.8 : 1.25); }
  };
  const events = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, pointerleave: leave, keydown: key };
  for (const [name, fn] of Object.entries(events)) canvas.addEventListener(name, fn);
  canvas.addEventListener("wheel", wheel, { passive: false });
  const observer = new ResizeObserver(() => {
    const nextWidth = Math.max(1, container.clientWidth), nextHeight = Math.max(1, container.clientHeight);
    camera.x += (nextWidth - width) / 2; camera.y += (nextHeight - height) / 2;
    width = nextWidth; height = nextHeight; app.renderer.resize(width, height); invalidate();
  });
  observer.observe(container);
  const fit = () => {
    if (!positions.length) { camera = { x: width / 2, y: height / 2, zoom: 1 }; cameraChanged(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 2) { minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]); minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]); }
    const scale = Math.max(0.015, Math.min(1.5, Math.max(1, width - 80) / Math.max(100, maxX - minX), Math.max(1, height - 80) / Math.max(100, maxY - minY)));
    camera = { x: width / 2 - (minX + maxX) / 2 * scale, y: height / 2 - (minY + maxY) / 2 * scale, zoom: scale }; cameraChanged();
  };
  return {
    setGraph(next) {
      finishDrag(); graph = next; hover = -1; autoFit = true; nodeColors = [];
      if (replayState) { replayState = null; onReplay(false); }
      sprites.forEach((sprite) => sprite.destroy()); sprites = [];
      texts.forEach((text) => text.destroy()); texts = []; destroyEdges();
      positions = new Float32Array(next.nodes.length * 2); screen = new Float32Array(positions.length);
      for (let i = 0; i < next.nodes.length; i++) { positions[2 * i] = Math.cos(i * 2.399963229728653) * Math.sqrt(i + 1) * 25; positions[2 * i + 1] = Math.sin(i * 2.399963229728653) * Math.sqrt(i + 1) * 25; }
      if (next.links.length) {
        vertices = new Float32Array(next.links.length * 7); colors = new Float32Array(next.links.length * 14);
        const indices = new Uint32Array(next.links.length / 2 * 9);
        for (let i = 0; i < next.links.length / 2; i++) indices.set([7 * i, 7 * i + 1, 7 * i + 2, 7 * i, 7 * i + 2, 7 * i + 3, 7 * i + 4, 7 * i + 5, 7 * i + 6], i * 9);
        positionBuffer = new Buffer({ data: vertices, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
        colorBuffer = new Buffer({ data: colors, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
        geometry = new Geometry({ attributes: { aPosition: { buffer: positionBuffer, format: "float32x2" }, aColor: { buffer: colorBuffer, format: "float32x4" } }, indexBuffer: indices });
        shader = Shader.from({ gl: { vertex: "in vec2 aPosition; in vec4 aColor; out vec4 vColor; void main(){ gl_Position=vec4(aPosition,0.,1.); vColor=aColor; }", fragment: "in vec4 vColor; out vec4 finalColor; void main(){ finalColor=vColor; }" } });
        edgeMesh = new Mesh({ geometry, shader }); app.stage.addChildAt(edgeMesh, 0);
      }
      fit();
      return positions.slice();
    },
    setPositions(next) { if (next.length === positions.length) { positions.set(next); if (autoFit) fit(); else invalidate(); } },
    setColors(next) { nodeColors = next; invalidate(); },
    replay() {
      if (!graph?.nodes.length) return;
      finishDrag(); hover = -1;
      const order = graphReplayOrder(graph);
      let last = 0; for (const rank of order) last = Math.max(last, rank);
      replayState = { order, last, start: performance.now() }; onReplay(true); invalidate();
    },
    stopReplay() { if (replayState) { replayState = null; onReplay(false); invalidate(); } },
    setActive(id) { active = id; invalidate(); },
    setDisplay(next) { display = { ...display, ...next }; invalidate(); },
    setFont(next) { labelFont = next; texts.forEach((text) => { text.style.fontFamily = next; }); invalidate(); },
    fit, zoom,
    destroy() {
      if (destroyed) return;
      finishDrag(); destroyed = true; observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame);
      for (const [name, fn] of Object.entries(events)) canvas.removeEventListener(name, fn);
      canvas.removeEventListener("wheel", wheel); destroyEdges();
      app.destroy(true, { children: true }); texture.destroy(true);
    },
  };
}
