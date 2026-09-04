using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Tides.Api.Services;
using Tides.Api.Tests.Fakes;

namespace Tides.Api.Tests;

/// <summary>
/// The Canadian source. Same contract as the NOAA tests - what IWLS publishes is what the chart
/// has to draw - plus the chunking, which is the one place a long range could silently lose days.
/// </summary>
public class IwlsApiServiceTests
{
    private static IwlsApiService Build(StubHttpMessageHandler handler) =>
        new(new StubHttpClientFactory(handler), new MemoryCache(new MemoryCacheOptions()),
            NullLogger<IwlsApiService>.Instance);

    private const string PredictionsJson = """
    [
      { "eventDate": "2026-09-03T00:00:00Z", "value": 3.412 },
      { "eventDate": "2026-09-03T00:15:00Z", "value": 3.208 },
      { "eventDate": "2026-09-03T00:30:00Z", "value": 2.99 }
    ]
    """;

    [Fact]
    public async Task Predictions_carry_the_upstream_values_exactly()
    {
        var handler = new StubHttpMessageHandler().RespondsTo("time-series-code=wlp", PredictionsJson);

        var points = await Build(handler).GetTidePredictionsAsync(
            "5cebf1de3d0f4a073c4bb996", new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 9, 4, 0, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new[] { 3.412, 3.208, 2.99 }, points.Select(p => p.Value));
        Assert.Equal(new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc), points[0].Timestamp);
        Assert.All(points, p => Assert.Equal(DateTimeKind.Utc, p.Timestamp.Kind));
    }

    [Fact]
    public async Task A_range_past_the_upstream_cap_is_chunked_and_covers_the_whole_span()
    {
        // IWLS caps a request at about 30 days. A 70-day range therefore has to go up as three
        // requests whose windows meet end to end - a gap between them would be a stretch of chart
        // with no wave on it.
        var handler = new StubHttpMessageHandler().RespondsTo("time-series-code=wlp", PredictionsJson);
        var from = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var to = from.AddDays(70);

        await Build(handler).GetTidePredictionsAsync("station", from, to);

        Assert.Equal(3, handler.Requests.Count);

        var windows = handler.Requests
            .Select(uri => System.Web.HttpUtility.ParseQueryString(uri.Query))
            .Select(q => (From: DateTime.Parse(q["from"]!).ToUniversalTime(), To: DateTime.Parse(q["to"]!).ToUniversalTime()))
            .OrderBy(w => w.From)
            .ToList();

        Assert.Equal(from, windows[0].From);
        Assert.Equal(to, windows[^1].To);
        for (var i = 1; i < windows.Count; i++)
            Assert.Equal(windows[i - 1].To, windows[i].From);
    }

    [Fact]
    public async Task Stations_without_a_prediction_series_are_left_out()
    {
        // Roughly a third of IWLS stations carry no wlp series and 404 when asked for
        // predictions, so offering them in the picker only produces a broken chart.
        const string stationsJson = """
        [
          { "id": "a1", "code": "07735", "officialName": "Vancouver", "latitude": 49.29, "longitude": -123.11,
            "operating": true, "timezone": "America/Vancouver", "timeSeries": [ { "code": "wlp" }, { "code": "wlo" } ] },
          { "id": "a2", "code": "00001", "officialName": "No Predictions Here", "latitude": 50.0, "longitude": -125.0,
            "operating": true, "timezone": "America/Vancouver", "timeSeries": [ { "code": "wlo" } ] }
        ]
        """;
        var handler = new StubHttpMessageHandler().RespondsTo("stations", stationsJson);

        var stations = await Build(handler).GetAllStationsAsync();

        Assert.Equal(new[] { "07735" }, stations.Select(s => s.Code));
        Assert.Equal("Canada", stations[0].Country);
    }
}
