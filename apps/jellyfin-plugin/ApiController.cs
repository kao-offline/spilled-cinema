using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.SpilledCinema;

[ApiController]
[Authorize]
[Route("SpilledCinema")]
public sealed class SpilledController : ControllerBase
{
    private readonly SpilledClient _client = new();
    [HttpGet("Status")]
    public Task<JsonElement> Status(CancellationToken token) => _client.Request("api/status", null, token);
    [HttpGet("Providers")]
    public Task<JsonElement> Providers(CancellationToken token) => _client.Request("api/provider-modules", null, token);
    [HttpGet("Library")]
    public async Task<object> Library(CancellationToken token) => (await _client.Library(token)).Select(x => new { reference = x.Reference.Encode(), show = x.Show });
    [HttpGet("Search")]
    public async Task<object> Search([FromQuery] string moduleId, [FromQuery] string query, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(moduleId) || query.Length is < 2 or > 200) return BadRequest("Choose a provider and enter 2–200 characters.");
        return await _client.Request("api/provider-search", new { moduleId, query }, token);
    }
    [HttpPost("Import")]
    public async Task<object> Import([FromBody] ImportRequest input, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(input.ModuleId) || string.IsNullOrWhiteSpace(input.Slug) || input.Slug.Length > 2048 || input.MediaType is not ("movie" or "serial")) return BadRequest("Invalid provider title.");
        var reference = new ContentReference("show", input.ModuleId, input.Slug, input.MediaType);
        var show = await _client.Import(reference, token, input.Refresh);
        return new { reference = reference.Encode(), show };
    }
    [HttpGet("Resolve")]
    public Task<JsonElement> Resolve([FromQuery] string reference, CancellationToken token) => _client.Resolve(ContentReference.Decode(reference), token);
    [HttpPost("Download")]
    [Authorize(Policy = "RequiresElevation")]
    public async Task<object> Download([FromBody] ReferenceRequest input, CancellationToken token)
    {
        if (!Plugin.Instance.Configuration.EnableDownloads) return BadRequest("Enable downloads in the plugin settings first.");
        return await _client.Download(ContentReference.Decode(input.Reference), token);
    }
    [HttpGet("Downloads")]
    [Authorize(Policy = "RequiresElevation")]
    public Task<JsonElement> Downloads(CancellationToken token) => _client.Request("api/download-full/list", null, token);
    [HttpGet("DownloadStatus")]
    [Authorize(Policy = "RequiresElevation")]
    public Task<JsonElement> DownloadStatus([FromQuery] string jobId, CancellationToken token) => _client.Request("api/download-full/status?jobId=" + Uri.EscapeDataString(jobId), null, token);
    [HttpPost("Downloads/Cancel")]
    [Authorize(Policy = "RequiresElevation")]
    public Task<JsonElement> CancelDownload([FromBody] DownloadJobRequest input, CancellationToken token) => _client.Request("api/download-full/cancel", new { episodeId = input.EpisodeId }, token);
    [HttpPost("Downloads/Delete")]
    [Authorize(Policy = "RequiresElevation")]
    public Task<JsonElement> DeleteDownload([FromBody] DownloadJobRequest input, CancellationToken token) => _client.Request("api/download-full/delete", new { episodeId = input.EpisodeId }, token);
    public sealed record ImportRequest(string ModuleId, string Slug, string MediaType = "serial", bool Refresh = false);
    public sealed record ReferenceRequest(string Reference);
    public sealed record DownloadJobRequest(string EpisodeId);
}
