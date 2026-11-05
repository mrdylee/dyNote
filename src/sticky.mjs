import "./sticky.css";

const memo = document.querySelector("#memo");
const pin = document.querySelector("#pin");
const status = document.querySelector("#status");
const updatePin = pinned => pin.setAttribute("aria-pressed", String(pinned));

document.querySelector("#close").addEventListener("click", () => window.sticky.close());
pin.addEventListener("click", () => window.sticky.pin());
memo.addEventListener("input", () => window.sticky.edit(memo.value));
window.sticky.onPinned(updatePin);
window.sticky.onStatus(({ message, error }) => {
  status.textContent = message;
  status.classList.toggle("error", error);
});

const initial = await window.sticky.state();
document.body.dataset.color = initial.color;
memo.value = initial.content;
memo.disabled = false;
updatePin(initial.pinned === true);
status.textContent = initial.saved ? "저장됨" : "";
memo.focus();
