using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.SpilledCinema;

[ApiController]
[Route("SpilledCinema/Stream")]
public sealed class StreamController : ControllerBase
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(100) };
    [AllowAnonymous]
    [HttpGet("{file}")]
    [HttpHead("{file}")]
    public async Task<IActionResult> Stream([FromQuery] string path, [FromQuery] long expires, [FromQuery] string signature, CancellationToken token)
    {
        if (!StreamLinks.Verify(path, expires, signature, Plugin.Instance.StreamKey)) return Unauthorized();
        using var request = new HttpRequestMessage(HttpMethods.IsHead(Request.Method) ? HttpMethod.Head : HttpMethod.Get, new Uri(new SpilledClient().ServerUri, path));
        if (Request.Headers.TryGetValue("Range", out var range)) request.Headers.TryAddWithoutValidation("Range", range.ToString());
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        Response.StatusCode = (int)response.StatusCode;
        foreach (var header in new[] { "Content-Type", "Content-Range", "Accept-Ranges" })
            if (response.Headers.TryGetValues(header, out var values) || response.Content.Headers.TryGetValues(header, out values)) Response.Headers[header] = string.Join(",", values);
        Response.Headers.CacheControl = "private, no-store";
        if (HttpMethods.IsHead(Request.Method)) { Response.ContentLength = response.Content.Headers.ContentLength; return new EmptyResult(); }
        var contentType = response.Content.Headers.ContentType?.MediaType ?? "";
        if (response.IsSuccessStatusCode && contentType.Contains("mpegurl", StringComparison.OrdinalIgnoreCase))
            await Response.WriteAsync(StreamLinks.RewritePlaylist(await response.Content.ReadAsStringAsync(token), expires), token);
        else
        {
            if (response.Content.Headers.ContentLength.HasValue) Response.ContentLength = response.Content.Headers.ContentLength;
            await response.Content.CopyToAsync(Response.Body, token);
        }
        return new EmptyResult();
    }
}
