import { expect, it } from "vitest";
import { hlsOptionsFromHelp } from "../ffmpeg-options";

it("accepts Debian FFmpeg without the newer HLS flags", () => expect(hlsOptionsFromHelp("-allowed_extensions <string>" )).toEqual([]));
it("enables the stricter FFmpeg HLS flags only when available", () => expect(hlsOptionsFromHelp("-allowed_segment_extensions <string>\n-extension_picky <boolean>")).toEqual(["-allowed_segment_extensions", "ALL", "-extension_picky", "0"]));
