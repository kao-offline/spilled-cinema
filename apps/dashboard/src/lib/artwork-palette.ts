export function deriveArtworkPalette(pixels: Uint8ClampedArray, width: number, height: number): string[] {
  return [0, 1, 2].map((zone) => {
    const channels = [0, 0, 0];
    let weights = 0;
    for (let y = 0; y < height; y++) for (let x = Math.floor(zone * width / 3); x < Math.floor((zone + 1) * width / 3); x++) {
      const offset = (y * width + x) * 4;
      const [r, g, b, alpha] = pixels.slice(offset, offset + 4);
      const maximum = Math.max(r, g, b);
      if (!alpha || maximum < 20 || Math.min(r, g, b) > 230) continue;
      const weight = ((maximum - Math.min(r, g, b)) / 255 + .2) * alpha / 255;
      channels[0] += r * weight; channels[1] += g * weight; channels[2] += b * weight; weights += weight;
    }
    return weights ? `rgb(${channels.map((value) => Math.round(value / weights * .42)).join(" ")})` : "rgb(11 17 28)";
  });
}
