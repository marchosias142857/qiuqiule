// Physics and input always use CSS pixels. Only the drawing buffer is supersampled.
export function displayMetrics(width, height, devicePixelRatio = 1) {
  const ratio = Math.max(2, Math.min(4, devicePixelRatio));
  // Bound framebuffer memory on large desktop displays, without changing game coordinates.
  const scale = Math.min(ratio, 8192 / width, 8192 / height, Math.sqrt(12_000_000 / (width * height)));
  return {width, height, scale, bufferWidth: Math.round(width * scale), bufferHeight: Math.round(height * scale)};
}

export function pointerPosition(clientX, clientY, rect, viewport) {
  return {x:(clientX - rect.left) * viewport.width / rect.width, y:(clientY - rect.top) * viewport.height / rect.height};
}
