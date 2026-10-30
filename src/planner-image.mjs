const MAX_SOURCE = 25 * 1024 * 1024;
const MAX_IMAGE = 6 * 1024 * 1024;

const readImage = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ mimeType: blob.type, data: String(reader.result).split(',')[1] });
  reader.onerror = () => reject(new Error('이미지를 읽을 수 없습니다.'));
  reader.readAsDataURL(blob);
});

export async function prepareCaptureImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('PNG·JPEG·WebP 이미지 한 장을 선택해 주세요.');
  if (file.size > MAX_SOURCE) throw new Error('원본 캡처는 최대 25MB까지 보관할 수 있습니다. 필요한 일정 영역만 잘라 다시 붙여넣어 주세요.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('이미지를 읽을 수 없습니다. PNG·JPEG·WebP 파일인지 확인해 주세요.'); }
  try {
    if (file.size <= MAX_IMAGE) return await readImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (png && png.size <= MAX_IMAGE) return await readImage(png);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    for (const quality of [.95, .9, .85, .8]) {
      const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (jpeg && jpeg.size <= MAX_IMAGE) return await readImage(jpeg);
    }
    throw new Error('원본 해상도를 유지한 압축으로 AI 전송 크기를 맞출 수 없습니다. 필요한 일정 영역만 잘라 다시 붙여넣어 주세요.');
  } finally { bitmap.close(); }
}
