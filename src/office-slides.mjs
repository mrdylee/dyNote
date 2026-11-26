import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer/browser";

const stage = document.querySelector("#stage");
const message = document.querySelector("#message");
const position = document.querySelector("#position");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
let viewer, page = 0, rendering = false;

function controls() {
  previous.disabled = rendering || page === 0;
  next.disabled = rendering || !viewer || page >= viewer.slideCount - 1;
  position.value = viewer ? `${page + 1} / ${viewer.slideCount}` : "";
}
async function move(delta) {
  if (!viewer || rendering || page + delta < 0 || page + delta >= viewer.slideCount) return;
  rendering = true;
  controls();
  try {
    await viewer.renderSlide(page + delta);
    page += delta;
    parent.postMessage({ slideIndex: page }, "notes://app");
    message.hidden = true;
  } catch {
    message.textContent = "이 슬라이드를 표시할 수 없습니다.";
    message.hidden = false;
  } finally {
    rendering = false;
    controls();
  }
}
previous.onclick = () => move(-1);
next.onclick = () => move(1);
window.addEventListener("keydown", event => {
  if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    void move(event.key === "ArrowLeft" ? -1 : 1);
  }
});
// The preview origin has no access to the notebook or Electron API.
window.addEventListener("message", async event => {
  if (event.source !== parent || event.origin !== "notes://app") return;
  if (/^#[0-9a-f]{6}$/i.test(event.data?.accent)) {
    document.documentElement.style.setProperty("--accent", event.data.accent);
  }
  if (!(event.data?.bytes instanceof Uint8Array) || viewer || rendering) return;
  rendering = true;
  try {
    viewer = await PptxViewer.open(new Uint8Array(event.data.bytes).buffer, stage, {
      renderMode: "slide", fitMode: "contain", lazySlides: true, lazyMedia: true,
      pdfjs: false, zipLimits: RECOMMENDED_ZIP_LIMITS,
    });
    if (!viewer.slideCount) throw new Error();
    page = Math.max(0, Math.min(event.data.slideIndex || 0, viewer.slideCount - 1));
    if (page) await viewer.renderSlide(page);
    parent.postMessage({ slideIndex: page }, "notes://app");
    message.hidden = true;
  } catch {
    viewer = null;
    message.textContent = "슬라이드를 표시할 수 없습니다. 앱에서 원본을 열어 주세요.";
  } finally {
    rendering = false;
    controls();
  }
});
