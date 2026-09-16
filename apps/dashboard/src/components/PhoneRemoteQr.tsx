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
      aria-label={`QR code linking to ${value}`}
      className="rounded-2xl bg-white p-0"
    >
      {cells.map((cell) => (
        <rect key={`${cell.x}:${cell.y}`} x={cell.x + 4} y={cell.y + 4} width={1} height={1} fill="#05070b" />
      ))}
      <rect x={0} y={0} width={side} height={side} fill="none" />
      <title>{value}</title>
    </svg>
  );
}
