using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.SpilledCinema;

public sealed record ContentReference(string Kind, string Module = "", string Slug = "", string MediaType = "serial", int Season = 0, string Episode = "", string Player = "")
{
    public string Encode() => Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(this)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static ContentReference Decode(string value)
    {
        if (value.Length > 8192) throw new ArgumentException("Content reference is too long.");
        var text = value.Replace('-', '+').Replace('_', '/');
        text = text.PadRight((text.Length + 3) / 4 * 4, '=');
        var reference = JsonSerializer.Deserialize<ContentReference>(Convert.FromBase64String(text)) ?? throw new ArgumentException("Invalid content reference.");
        if (!new[] { "library", "module", "feed", "show", "season", "episode", "players", "player" }.Contains(reference.Kind)) throw new ArgumentException("Unknown content reference.");
        return reference;
    }
}

public static class JsonFields
{
    public static string Text(this JsonElement element, string name, string fallback = "") => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? fallback : fallback;
    public static int Number(this JsonElement element, string name, int fallback = 0) => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) ? number : fallback;
    public static IEnumerable<JsonElement> Rows(this JsonElement element, string name) => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : [];
}

public sealed class SpilledClient
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(100) };
    private static readonly SemaphoreSlim ImportLock = new(1, 1);
    public Uri ServerUri
    {
        get
        {
            var url = new Uri(Plugin.Instance.Configuration.ServerUrl.TrimEnd('/') + "/");
            if (url.Scheme != "http" && url.Scheme != "https") throw new InvalidOperationException("SpilledCinema URL must use HTTP or HTTPS.");
            return url;
        }
    }
    public async Task<JsonElement> Request(string path, object? body, CancellationToken token)
    {
        using var response = body is null ? await Http.GetAsync(new Uri(ServerUri, path), token) : await Http.PostAsJsonAsync(new Uri(ServerUri, path), body, token);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"SpilledCinema request failed ({(int)response.StatusCode}) for {path}.", null, response.StatusCode);
        using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(token), cancellationToken: token);
        return document.RootElement.Clone();
    }
    public static int? PlaylistBandwidth(string playlist)
    {
        var values = playlist.Split('\n').Where(line => line.StartsWith("#EXT-X-STREAM-INF:", StringComparison.Ordinal))
            .SelectMany(line => Regex.Matches(line, @"(?:[:,])BANDWIDTH=(\d+)"))
            .Select(match => int.TryParse(match.Groups[1].Value, out var value) ? value : 0).Where(value => value > 0).ToArray();
        return values.Length == 0 ? null : values.Max();
    }
    public async Task<int?> PlaylistBandwidth(Uri uri, CancellationToken token)
    {
        using var response = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, token);
        response.EnsureSuccessStatusCode();
        using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(token));
        var buffer = new char[1024 * 1024];
        var count = await reader.ReadBlockAsync(buffer.AsMemory(), token);
        return count == buffer.Length ? null : PlaylistBandwidth(new string(buffer, 0, count));
    }
    private static string CatalogPath(ContentReference reference)
    {
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(reference.Module + "\n" + reference.Slug))).ToLowerInvariant();
        return Path.Combine(Plugin.Instance.CatalogDirectory, key + ".json");
    }
    public async Task<JsonElement> Import(ContentReference reference, CancellationToken token, bool refresh = false)
    {
        var path = CatalogPath(reference);
        await ImportLock.WaitAsync(token);
        try
        {
            if (!refresh && File.Exists(path))
            {
                using var saved = JsonDocument.Parse(await File.ReadAllTextAsync(path, token));
                return saved.RootElement.GetProperty("show").Clone();
            }
            var response = await Request("api/provider-import", new { moduleId = reference.Module, slug = reference.Slug, mediaType = reference.MediaType }, token);
            var show = response.GetProperty("show").Clone();
            if (!show.Rows("episodes").Any()) throw new InvalidOperationException("Provider returned a title without playable episodes.");
            Directory.CreateDirectory(Plugin.Instance.CatalogDirectory);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(new { reference, show }), token);
                File.Move(temporary, path, true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return show;
        }
        finally { ImportLock.Release(); }
    }
    public async Task<IReadOnlyList<(ContentReference Reference, JsonElement Show)>> Library(CancellationToken token)
    {
        var result = new List<(ContentReference, JsonElement)>();
        if (!Directory.Exists(Plugin.Instance.CatalogDirectory)) return result;
        foreach (var path in Directory.EnumerateFiles(Plugin.Instance.CatalogDirectory, "*.json"))
        {
            using var saved = JsonDocument.Parse(await File.ReadAllTextAsync(path, token));
            var reference = saved.RootElement.GetProperty("reference").Deserialize<ContentReference>() ?? throw new InvalidDataException("Invalid saved title reference.");
            result.Add((reference, saved.RootElement.GetProperty("show").Clone()));
        }
        return result;
    }
    public async Task<JsonElement> Resolve(ContentReference reference, CancellationToken token)
    {
        var show = await Import(reference, token);
        var episode = show.Rows("episodes").FirstOrDefault(x => x.Text("id") == reference.Episode);
        if (episode.ValueKind == JsonValueKind.Undefined) throw new KeyNotFoundException("Episode is no longer available; refresh the title.");
        var players = episode.Rows("players").ToArray();
        if (players.Length == 0) throw new InvalidOperationException("Episode has no provider players.");
        var preferred = players.FirstOrDefault(x => x.Text("language").StartsWith(Plugin.Instance.Configuration.PreferredLanguage, StringComparison.OrdinalIgnoreCase));
        var alias = string.IsNullOrEmpty(reference.Player) ? preferred.ValueKind != JsonValueKind.Undefined ? preferred.Text("alias") : episode.Text("selectedPlayerAlias", players[0].Text("alias")) : reference.Player;
        if (!players.Any(x => x.Text("alias") == alias)) throw new ArgumentException("Player is not part of this episode.");
        if (!string.IsNullOrEmpty(reference.Player)) players = players.Where(x => x.Text("alias") == alias).ToArray();
        return await Request("api/player/playback-resolve", new
        {
            episodeId = episode.Text("id"), showTitle = show.Text("title"), episodeTitle = episode.Text("episodeTitle"),
            seasonNumber = episode.Number("seasonNumber"), episodeNumber = episode.Number("episodeNumber"),
            activePlayerAlias = alias, players
        }, token);
    }
    public async Task<JsonElement> Download(ContentReference reference, CancellationToken token)
    {
        var show = await Import(reference, token);
        var episode = show.Rows("episodes").First(x => x.Text("id") == reference.Episode);
        var players = episode.Rows("players").ToArray();
        var player = string.IsNullOrEmpty(reference.Player) ? players.First() : players.First(x => x.Text("alias") == reference.Player);
        return await Request("api/download-full/start", new
        {
            episodeId = episode.Text("id"), showTitle = show.Text("title"), episodeTitle = episode.Text("episodeTitle"),
            seasonNumber = episode.Number("seasonNumber"), episodeNumber = episode.Number("episodeNumber"),
            embedUrl = player.Text("embedUrl"), subtitlesUrl = player.Text("subtitlesUrl"), streamCandidates = players
        }, token);
    }
}
