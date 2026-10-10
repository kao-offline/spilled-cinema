using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using MediaBrowser.Controller.Channels;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Channels;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.MediaInfo;
using MediaBrowser.Controller.MediaEncoding;
using MediaBrowser.Model.Dlna;

namespace Jellyfin.Plugin.SpilledCinema;

public sealed class Channel : IChannel, IRequiresMediaInfoCallback
{
    private readonly IMediaEncoder _encoder;
    public Channel(IMediaEncoder encoder) => _encoder = encoder;
    private readonly SpilledClient _client = new();
    public string Name => "SpilledCinema";
    public string Description => "Provider feeds, imported movies and series. Streams are resolved when you press Play.";
    public string DataVersion => "2-" + (Directory.Exists(Plugin.Instance.CatalogDirectory) ? Directory.GetLastWriteTimeUtc(Plugin.Instance.CatalogDirectory).Ticks : 0);
    public string HomePageUrl => "https://github.com/kao-offline/spilled-cinema";
    public ChannelParentalRating ParentalRating => ChannelParentalRating.GeneralAudience;
    public bool IsEnabledFor(string userId) => true;
    public InternalChannelFeatures GetChannelFeatures() => new()
    {
        MediaTypes = [ChannelMediaType.Video],
        ContentTypes = [ChannelMediaContentType.Movie, ChannelMediaContentType.Episode],
        MaxPageSize = 100,
        AutoRefreshLevels = 0,
        SupportsContentDownloading = false
    };
    public IEnumerable<ImageType> GetSupportedChannelImages() => [];
    public Task<DynamicImageResponse> GetChannelImage(ImageType type, CancellationToken cancellationToken) => Task.FromResult(new DynamicImageResponse());
    private static ChannelItemInfo Folder(string name, ContentReference reference, string overview = "", string image = "", ChannelFolderType folderType = ChannelFolderType.Container) => new()
    {
        Id = reference.Encode(), Name = name, Type = ChannelItemType.Folder,
        FolderType = folderType, MediaType = ChannelMediaType.Video,
        IndexNumber = folderType == ChannelFolderType.Season ? reference.Season : null,
        Overview = overview, ImageUrl = image
    };
    public static ChannelItemInfo Title(JsonElement item, ContentReference reference) => Folder(
        item.Text("title", reference.Slug), reference, item.Text("description"), item.Text("posterUrl"),
        reference.MediaType == "movie" ? ChannelFolderType.Container : ChannelFolderType.Series);

    public async Task<ChannelItemResult> GetChannelItems(InternalChannelItemQuery query, CancellationToken cancellationToken)
    {
        var items = new List<ChannelItemInfo>();
        if (string.IsNullOrEmpty(query.FolderId))
        {
            items.Add(Folder("Imported library", new("library"), "Your imported titles. Select a provider below to browse and import more."));
            var modules = await _client.Request("api/provider-modules", null, cancellationToken);
            foreach (var module in modules.Rows("modules").Where(x => x.Text("status") != "disabled"))
                items.Add(Folder(module.Text("displayName"), new("module", module.Text("moduleId"))));
        }
        else
        {
            var reference = ContentReference.Decode(query.FolderId);
            switch (reference.Kind)
            {
                case "library":
                    foreach (var entry in await _client.Library(cancellationToken)) items.Add(Title(entry.Show, entry.Reference with { Kind = "show" }));
                    break;
                case "module":
                    var modules = await _client.Request("api/provider-modules", null, cancellationToken);
                    var module = modules.Rows("modules").First(x => x.Text("moduleId") == reference.Module);
                    foreach (var feed in module.GetProperty("capabilities").Rows("feeds"))
                        items.Add(Folder(feed.Text("title"), new("feed", reference.Module, feed.Text("feedId")), feed.Text("description")));
                    break;
                case "feed":
                    var response = await _client.Request("api/provider-feed", new { moduleId = reference.Module, feedId = reference.Slug, cursor = string.IsNullOrEmpty(reference.Episode) ? null : reference.Episode, limit = 50 }, cancellationToken);
                    foreach (var item in response.Rows("items"))
                        items.Add(Title(item, new("show", reference.Module, item.Text("importSlug", item.Text("slug")), item.Text("mediaType", "serial"))));
                    var cursor = response.Text("continueCursor");
                    if (!string.IsNullOrEmpty(cursor)) items.Add(Folder("More titles", reference with { Episode = cursor }));
                    break;
                case "show":
                case "season":
                    var show = await _client.Import(reference, cancellationToken);
                    var episodes = show.Rows("episodes").ToArray();
                    if (reference.Kind == "show" && reference.MediaType != "movie" && episodes.Any(x => x.Number("seasonNumber") > 0))
                    {
                        foreach (var season in episodes.Select(x => x.Number("seasonNumber")).Distinct().Order())
                            items.Add(Folder(season == 0 ? "Specials" : "Season " + season, reference with { Kind = "season", Season = season }, folderType: ChannelFolderType.Season));
                    }
                    else
                    {
                        foreach (var episode in episodes.Where(x => reference.Kind != "season" || x.Number("seasonNumber") == reference.Season).OrderBy(x => x.Number("episodeNumber")))
                        {
                            var episodeReference = reference with { Kind = "episode", Episode = episode.Text("id") };
                            items.Add(Episode(episode, show, episodeReference));
                            if (episode.Rows("players").Count() > 1) items.Add(Folder("Players · " + episode.Text("episodeTitle", episode.Text("episodeCode", "Movie")), episodeReference with { Kind = "players" }, "Select a language or provider instead of automatic resolution."));
                        }
                    }
                    break;
                case "players":
                    var playerShow = await _client.Import(reference, cancellationToken);
                    var playerEpisode = playerShow.Rows("episodes").First(x => x.Text("id") == reference.Episode);
                    foreach (var player in playerEpisode.Rows("players"))
                    {
                        var item = Episode(playerEpisode, playerShow, reference with { Kind = "player", Player = player.Text("alias") });
                        item.Name = player.Text("label", player.Text("provider")) + (string.IsNullOrEmpty(player.Text("language")) ? "" : " · " + player.Text("language"));
                        items.Add(item);
                    }
                    break;
                default: throw new ArgumentException("This content is playable, not a folder.");
            }
        }
        return new ChannelItemResult { Items = items.Skip(query.StartIndex ?? 0).Take(Math.Clamp(query.Limit ?? 100, 1, 100)).ToArray(), TotalRecordCount = items.Count };
    }
    private static ChannelItemInfo Episode(JsonElement episode, JsonElement show, ContentReference reference) => new()
    {
        Id = reference.Encode(), Name = episode.Text("episodeTitle", show.Text("title")),
        SeriesName = show.Text("title"), Type = ChannelItemType.Media, MediaType = ChannelMediaType.Video,
        ContentType = reference.MediaType == "movie" ? ChannelMediaContentType.Movie : ChannelMediaContentType.Episode,
        IndexNumber = episode.Number("episodeNumber"), ParentIndexNumber = episode.Number("seasonNumber"),
        ImageUrl = episode.Text("posterUrl", show.Text("posterUrl")), Overview = show.Text("description"),
        RunTimeTicks = episode.TryGetProperty("durationSeconds", out var duration) && duration.ValueKind == JsonValueKind.Number && duration.TryGetDouble(out var seconds) ? (long)(seconds * TimeSpan.TicksPerSecond) : null,
        DateCreated = DateTime.UtcNow
    };
    public async Task<IEnumerable<MediaSourceInfo>> GetChannelItemMediaInfo(string id, CancellationToken cancellationToken)
    {
        var reference = ContentReference.Decode(id);
        if (reference.Kind != "episode" && reference.Kind != "player") throw new ArgumentException("This item is not playable.");
        var result = await _client.Resolve(reference, cancellationToken);
        var playback = result.Text("playbackUrl");
        if (string.IsNullOrEmpty(playback)) throw new InvalidOperationException("SpilledCinema did not return a playable stream.");
        var path = new Uri(_client.ServerUri, playback).AbsoluteUri;
        var subtitles = result.Text("subtitlesUrl");
        var media = new MediaSourceInfo
        {
            Id = new Guid(SHA256.HashData(Encoding.UTF8.GetBytes(reference.Encode())).AsSpan(0, 16)).ToString("N"), Path = path, Protocol = MediaProtocol.Http,
            Container = result.Text("streamType") switch { "mp4" => "mp4", "dash" => "mpd", _ => "m3u8" },
            IsRemote = true, SupportsDirectPlay = true, SupportsDirectStream = true,
            SupportsTranscoding = false, SupportsProbing = true,
            AnalyzeDurationMs = 5000,
            MediaStreams = string.IsNullOrEmpty(subtitles) ? [] : [new MediaStream
            {
                Index = 0, Type = MediaStreamType.Subtitle, Codec = "vtt", IsExternal = true,
                Path = new Uri(_client.ServerUri, "api/subtitle-proxy?url=" + Uri.EscapeDataString(subtitles)).AbsoluteUri,
                Language = Plugin.Instance.Configuration.PreferredLanguage, IsDefault = true
            }]
        };
        using var probeToken = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        probeToken.CancelAfter(TimeSpan.FromSeconds(30));
        var info = await _encoder.GetMediaInfo(new MediaInfoRequest { MediaSource = media, MediaType = DlnaProfileType.Video, ExtractChapters = false }, probeToken.Token);
        var subtitleStreams = media.MediaStreams;
        media.MediaStreams = info.MediaStreams.Concat(subtitleStreams.Select((stream, index) => { stream.Index = info.MediaStreams.Count + index; return stream; })).ToArray();
        media.RunTimeTicks = info.RunTimeTicks;
        media.Bitrate = info.Bitrate;
        media.Container = info.Container;
        if (media.Container == "hls" && media.MediaStreams.Any(stream => stream.Type == MediaStreamType.Video && !stream.BitRate.HasValue))
        {
            var bandwidth = await _client.PlaylistBandwidth(new Uri(path), cancellationToken);
            if (bandwidth.HasValue)
            {
                // HLS BANDWIDTH includes audio. Using it for video deliberately overestimates
                // rather than claiming an unknown stream fits a client's bitrate limit.
                foreach (var stream in media.MediaStreams.Where(stream => stream.Type == MediaStreamType.Video && !stream.BitRate.HasValue)) stream.BitRate = bandwidth;
                media.Bitrate = bandwidth.Value + (media.MediaStreams.Where(stream => stream.Type == MediaStreamType.Audio).Max(stream => stream.BitRate) ?? 0);
            }
        }
        var audioStreams = media.MediaStreams.Where(stream => stream.Type == MediaStreamType.Audio).ToArray();
        if (audioStreams.Length > 0 && !audioStreams.Any(stream => stream.IsDefault)) audioStreams[0].IsDefault = true;
        media.DefaultAudioStreamIndex = media.MediaStreams.FirstOrDefault(stream => stream.Type == MediaStreamType.Audio)?.Index;
        var publicUrl = Plugin.Instance.Configuration.PublicJellyfinUrl;
        if (!Uri.TryCreate(publicUrl.TrimEnd('/') + "/", UriKind.Absolute, out var publicServer) || publicServer.Scheme is not ("http" or "https")) throw new InvalidOperationException("Configure the public Jellyfin URL in SpilledCinema settings.");
        media.Path = new Uri(publicServer, StreamLinks.Create(new Uri(path).PathAndQuery, fileType: result.Text("streamType") == "mp4" ? "mp4" : "m3u8")).AbsoluteUri;
        foreach (var stream in subtitleStreams) stream.Path = new Uri(publicServer, StreamLinks.Create(new Uri(stream.Path).PathAndQuery)).AbsoluteUri;
        return [media];
    }
}
