using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.SpilledCinema;

public sealed class PluginConfiguration : BasePluginConfiguration
{
    public string ServerUrl { get; set; } = "http://spilled-node:8787";
    public bool EnableDownloads { get; set; } = false;
    public string PreferredLanguage { get; set; } = "cs";
    public string PublicJellyfinUrl { get; set; } = "";
}

public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public Plugin(IApplicationPaths paths, IXmlSerializer serializer) : base(paths, serializer)
    {
        Instance = this;
        Directory.CreateDirectory(paths.PluginConfigurationsPath);
        var path = Path.Combine(paths.PluginConfigurationsPath, "spilledcinema-stream.key");
        if (!File.Exists(path))
        {
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using var file = new FileStream(path, options);
            file.Write(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        }
        StreamKey = File.ReadAllBytes(path);
        if (StreamKey.Length != 32) throw new InvalidDataException("Invalid SpilledCinema stream signing key.");
    }
    internal byte[] StreamKey { get; }
    public static Plugin Instance { get; private set; } = null!;
    public override string Name => "SpilledCinema";
    public override string Description => "Browse providers, import titles, and resolve streams with SpilledCinema directly in Jellyfin.";
    public override Guid Id => Guid.Parse("6bf9cdcb-c6b0-45d4-8a7b-d9d1d3df3b88");
    public string CatalogDirectory => Path.Combine(ApplicationPaths.PluginConfigurationsPath, "spilledcinema-catalog");
    public IEnumerable<PluginPageInfo> GetPages() => [new PluginPageInfo
    {
        Name = "SpilledCinema",
        EnableInMainMenu = true,
        MenuSection = "library",
        MenuIcon = "movie",
        EmbeddedResourcePath = GetType().Namespace + ".Configuration.configPage.html"
    }];
}
