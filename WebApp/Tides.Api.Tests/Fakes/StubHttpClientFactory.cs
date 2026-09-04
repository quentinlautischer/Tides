namespace Tides.Api.Tests.Fakes;

/// <summary>Hands every named client the same stubbed handler.</summary>
public class StubHttpClientFactory : IHttpClientFactory
{
    private readonly StubHttpMessageHandler _handler;
    private readonly Uri _baseAddress;

    public StubHttpClientFactory(StubHttpMessageHandler handler, string baseAddress = "https://upstream.test/")
    {
        _handler = handler;
        _baseAddress = new Uri(baseAddress);
    }

    public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false) { BaseAddress = _baseAddress };
}
