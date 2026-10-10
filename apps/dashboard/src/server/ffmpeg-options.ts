import { execFile } from "node:child_process";

export function hlsOptionsFromHelp(help: string) {
  return [
    ...(help.includes("allowed_segment_extensions") ? ["-allowed_segment_extensions", "ALL"] : []),
    ...(help.includes("extension_picky") ? ["-extension_picky", "0"] : []),
  ];
}
let options: Promise<string[]> | undefined;
export function getFfmpegHlsOptions() {
  return options ||= new Promise<string[]>((resolve, reject) => {
    execFile("ffmpeg", ["-hide_banner", "-h", "demuxer=hls"], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(hlsOptionsFromHelp(stdout + stderr));
    });
  });
}
