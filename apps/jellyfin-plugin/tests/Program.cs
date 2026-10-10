using System.Text.Json;
using Jellyfin.Plugin.SpilledCinema;
using MediaBrowser.Model.Channels;

static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
var reference = new ContentReference("player", "provider", "příběh", "serial", 2, "episode-3", "player-cs");
Check(ContentReference.Decode(reference.Encode()) == reference, "Unicode content references must survive a native channel round trip.");
foreach (var bad in new[] { "!invalid", new ContentReference("unknown").Encode(), new string('a', 8193) })
{
    var rejected = false;
    try { ContentReference.Decode(bad); } catch (Exception error) when (error is ArgumentException or FormatException or JsonException) { rejected = true; }
    Check(rejected, "Malformed channel references must be rejected.");
}
using var document = JsonDocument.Parse("{\"title\":\"Movie\",\"episodeNumber\":null,\"seasonNumber\":2,\"description\":null}");
var item = document.RootElement;
Check(item.Number("episodeNumber") == 0, "Providers can return null movie episode numbers.");
Check(item.Number("seasonNumber") == 2, "Season metadata must be retained.");
Check(item.Text("description", "fallback") == "fallback", "Nullable metadata must have a safe fallback.");
Check(Channel.Title(item, reference with { MediaType = "movie" }).FolderType == ChannelFolderType.Container, "Movies must browse without a season folder.");
Check(Channel.Title(item, reference).FolderType == ChannelFolderType.Series, "Series must retain native folder semantics.");
Console.WriteLine("SpilledCinema plugin reference and metadata checks passed.");
var key = System.Security.Cryptography.RandomNumberGenerator.GetBytes(32);
const string proxyPath = "/api/download-full/browser-file/stream.ts?url=https%3A%2F%2Fmedia.example%2Fsegment.ts";
var expiry = DateTimeOffset.UtcNow.AddMinutes(5).ToUnixTimeSeconds();
var signature = StreamLinks.Sign(proxyPath, expiry, key);
Check(StreamLinks.Verify(proxyPath, expiry, signature, key), "An issued playback link must be valid.");
Check(!StreamLinks.Verify(proxyPath + "&extra=1", expiry, signature, key), "Playback paths cannot be changed after signing.");
Check(!StreamLinks.Verify(proxyPath, 1, signature, key), "Expired playback links must be rejected.");
Check(!StreamLinks.Verify("/api/status", expiry, StreamLinks.Sign("/api/status", expiry, key), key), "Playback links cannot authorize other server routes.");
Check(!StreamLinks.Verify(proxyPath, expiry, "invalid", key), "Malformed signatures must be rejected.");
Console.WriteLine("Signed playback link checks passed.");
Check(SpilledClient.PlaylistBandwidth("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,CODECS=\"avc1\"\nvideo.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1280x720,BANDWIDTH=4000000\nlarge.m3u8") == 4000000, "HLS bandwidth must conservatively cover all advertised variants.");
Check(SpilledClient.PlaylistBandwidth("#EXTM3U\n#EXTINF:3\nsegment.ts") is null, "Media playlists without bandwidth must retain unknown bitrate.");
Check(SpilledClient.PlaylistBandwidth("#EXT-X-STREAM-INF:BANDWIDTH=1200000,AVERAGE-BANDWIDTH=1000000") == 1200000, "Single-variant manifests must use peak bandwidth.");
Check(StreamLinks.MediaExtension("/api/download-full/browser-file/stream.m4s") == "m4s", "Fragmented MP4 segments must keep their extension for strict HLS demuxers.");
Check(StreamLinks.MediaExtension("/api/download-full/browser-file", "mp4") == "mp4", "Resolved MP4 playback must be advertised as MP4.");
Check(StreamLinks.MediaExtension("/api/subtitle-proxy") == "vtt", "External subtitles must remain VTT.");
Check(typeof(Plugin).Assembly.GetManifestResourceNames().Contains("Jellyfin.Plugin.SpilledCinema.Configuration.configPage.html"), "The native menu page must be embedded under the name Jellyfin requests.");
