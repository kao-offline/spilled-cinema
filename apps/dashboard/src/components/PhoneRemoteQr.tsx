import { useMemo } from "react";
import qrcode from "qrcode-generator";

type PhoneRemoteQrProps = {
  value: string;
  size?: number;
};

/** High-contrast QR with a quiet zone, rendered as SVG rects (no innerHTML). */
export function PhoneRemoteQr({ value, size = 208 }: PhoneRemoteQrProps) {
  const { cells, side } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    const cells: Array<{ x: number; y: number }> = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (code.isDark(row, col)) cells.push({ x: col, y: row });
      }
    }
    return { cells, side: count + 8 };
  }, [value]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      // The URL carries a pairing secret, so the accessible name stays
      // generic instead of reading the secret aloud.
      aria-label="QR code to open the Spilled phone remote"
      className="rounded-2xl overflow-hidden p-0"
    >
      <rect x={0} y={0} width={side} height={side} fill="#ffffff" />
      {cells.map((cell) => (
        <rect key={`${cell.x}:${cell.y}`} x={cell.x + 4} y={cell.y + 4} width={1} height={1} fill="#05070b" />
      ))}
      <title>Spilled phone remote pairing code</title>
    </svg>
  );
}
