using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.SpilledCinema;

public static class StreamLinks
{
    private const string Prefix = "/api/download-full/browser-file";
    public static string Sign(string path, long expires, byte[] key) => Convert.ToHexString(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(expires + "\n" + path))).ToLowerInvariant();
    public static bool Verify(string path, long expires, string signature, byte[] key)
    {
        if (expires < DateTimeOffset.UtcNow.ToUnixTimeSeconds() || expires > DateTimeOffset.UtcNow.AddHours(6).ToUnixTimeSeconds() || !IsProxyPath(path)) return false;
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(signature), Convert.FromHexString(Sign(path, expires, key))); } catch (FormatException) { return false; }
    }
    private static bool IsProxyPath(string path) => path.StartsWith(Prefix + "?", StringComparison.Ordinal) || path.StartsWith(Prefix + "/stream.", StringComparison.Ordinal) || path.StartsWith("/api/subtitle-proxy?", StringComparison.Ordinal);
    public static string MediaExtension(string path, string? fileType = null)
    {
        if (fileType is "mp4" or "m3u8" or "vtt" or "ts") return fileType;
        if (path.StartsWith("/api/subtitle-proxy", StringComparison.Ordinal)) return "vtt";
        var match = Regex.Match(path, @"\.(m3u8|ts|mp4|m4s|aac|vtt|key)$", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value.ToLowerInvariant() : "m3u8";
    }
    public static string Create(string path, long? expires = null, string? fileType = null)
    {
        var server = new Uri(new SpilledClient().ServerUri, path);
        path = server.PathAndQuery;
        if (!IsProxyPath(path)) throw new ArgumentException("Only SpilledCinema playback proxy paths can be signed.");
        var expiry = expires ?? DateTimeOffset.UtcNow.AddHours(5).ToUnixTimeSeconds();
        var extension = MediaExtension(server.AbsolutePath, fileType);
        return "/SpilledCinema/Stream/media." + extension + "?path=" + Uri.EscapeDataString(path) + "&expires=" + expiry + "&signature=" + Sign(path, expiry, Plugin.Instance.StreamKey);
    }
    public static string RewritePlaylist(string playlist, long expires)
    {
        return string.Join("\n", playlist.Split('\n').Select(line => line.StartsWith('#')
            ? Regex.Replace(line, "URI=([\"'])([^\"']+)\\1", match => "URI=" + match.Groups[1].Value + Create(match.Groups[2].Value, expires) + match.Groups[1].Value)
            : string.IsNullOrWhiteSpace(line) ? line : Create(line.Trim(), expires)));
    }
}
