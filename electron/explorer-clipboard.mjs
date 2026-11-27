import { createRequire } from "node:module";

let reader;
function windowsReader() {
  const koffi = createRequire(import.meta.url)("koffi");
  const user = koffi.load("user32.dll"), kernel = koffi.load("kernel32.dll");
  const open = user.func("int __stdcall OpenClipboard(void *)");
  const close = user.func("int __stdcall CloseClipboard()");
  const data = user.func("void * __stdcall GetClipboardData(uint32_t)");
  const sequence = user.func("uint32_t __stdcall GetClipboardSequenceNumber()");
  const register = user.func("uint32_t __stdcall RegisterClipboardFormatW(str16)");
  const dropEffect = register("Preferred DropEffect");
  const lock = kernel.func("void * __stdcall GlobalLock(void *)");
  const unlock = kernel.func("int __stdcall GlobalUnlock(void *)");
  const size = kernel.func("size_t __stdcall GlobalSize(void *)");
  const query = koffi.load("shell32.dll").func("uint32_t __stdcall DragQueryFileW(void *, uint32_t, void *, uint32_t)");
  return () => {
    if (!open(null)) throw new Error("클립보드를 사용 중입니다. 다시 붙여넣어 주세요.");
    try {
      const drop = data(15); // CF_HDROP
      const paths = [];
      if (drop) {
        const count = query(drop, 0xffffffff, null, 0);
        for (let index = 0; index < count; index++) {
          const length = query(drop, index, null, 0);
          const buffer = Buffer.alloc((length + 1) * 2);
          if (!length || query(drop, index, buffer, length + 1) !== length)
            throw new Error("클립보드에서 파일 이름을 읽을 수 없습니다.");
          paths.push(buffer.toString("utf16le", 0, length * 2));
        }
      }
      const effect = drop && data(dropEffect);
      const pointer = effect && size(effect) >= 4 && lock(effect);
      let operation = "copy";
      if (pointer) {
        try { if (koffi.decode(pointer, "uint32_t") === 2) operation = "move"; }
        finally { unlock(effect); }
      }
      return { paths, operation, sequence: sequence() };
    } finally { close(); }
  };
}

export function readExplorerClipboard() {
  reader ??= windowsReader();
  return reader();
}
