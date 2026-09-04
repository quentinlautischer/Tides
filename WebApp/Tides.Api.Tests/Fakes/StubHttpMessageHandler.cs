using System.Net;
using System.Text;

namespace Tides.Api.Tests.Fakes;

/// <summary>
/// Stands in for the upstream authority. Requests are matched on a substring of the URL, which is
/// enough to tell one product apart from another (predictions vs hilo vs water_level) without
/// pinning the tests to the exact query string the service happens to build today.
///
/// Every request that reaches it is recorded, so a test can assert on how a range was chunked as
/// well as on what came back.
/// </summary>
public class StubHttpMessageHandler : HttpMessageHandler
{
    private readonly List<(string Match, HttpResponseMessage Response)> _responses = [];

    public List<Uri> Requests { get; } = [];

    public StubHttpMessageHandler RespondsTo(string urlContains, string json, HttpStatusCode status = HttpStatusCode.OK)
    {
        _responses.Add((urlContains, new HttpResponseMessage(status)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        }));
        return this;
    }

    /// <summary>Every matching request gets the same body, which is what a chunked range needs.</summary>
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request.RequestUri!);

        var url = request.RequestUri!.ToString();
        foreach (var (match, response) in _responses)
        {
            if (!url.Contains(match, StringComparison.OrdinalIgnoreCase))
                continue;

            return Task.FromResult(new HttpResponseMessage(response.StatusCode)
            {
                Content = new StringContent(response.Content.ReadAsStringAsync(cancellationToken).Result,
                    Encoding.UTF8, "application/json")
            });
        }

        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound)
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json")
        });
    }
}
