using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Tides.Api.Models;
using Tides.Api.Services;
using Tides.Api.Tests.Fakes;

namespace Tides.Api.Tests;

/// <summary>
/// What NOAA publishes has to survive the trip into the chart unchanged. These pin the parse
/// against payloads in NOAA's own shape: the heights are theirs to the last digit, the timestamps
/// are the ones they stamped, and nothing is quietly rounded, reordered or shifted on the way.
/// </summary>
public class NoaaApiServiceTests
{
    private static NoaaApiService Build(StubHttpMessageHandler handler) =>
        new(new StubHttpClientFactory(handler), new MemoryCache(new MemoryCacheOptions()),
            NullLogger<NoaaApiService>.Instance);

    // A real-shaped 15-minute prediction slice: NOAA serves "yyyy-MM-dd HH:mm" strings and
    // stringified metres, requested with time_zone=gmt so the clock is UTC.
    private const string PredictionsJson = """
    {
      "predictions": [
        { "t": "2026-09-03 00:00", "v": "1.234" },
        { "t": "2026-09-03 00:15", "v": "1.401" },
        { "t": "2026-09-03 00:30", "v": "-0.152" },
        { "t": "2026-09-03 00:45", "v": "2.5" }
      ]
    }
    """;

    [Fact]
    public async Task Predictions_carry_the_upstream_values_exactly()
    {
        var handler = new StubHttpMessageHandler().RespondsTo("product=predictions", PredictionsJson);

        var points = await Build(handler).GetTidePredictionsAsync(
            "9447130", new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc), new DateTime(2026, 9, 4, 0, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new[] { 1.234, 1.401, -0.152, 2.5 }, points.Select(p => p.Value));
        Assert.Equal(new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc), points[0].Timestamp);
        Assert.Equal(new DateTime(2026, 9, 3, 0, 45, 0, DateTimeKind.Utc), points[3].Timestamp);
    }

    [Fact]
    public async Task Prediction_timestamps_are_marked_utc()
    {
        // The controller converts these into the station's own zone before they reach the chart,
        // and ConvertTimeFromUtc refuses a timestamp that isn't tagged UTC. A point that came
        // back Unspecified would blow up there rather than here, which is the wrong place to
        // find out.
        var handler = new StubHttpMessageHandler().RespondsTo("product=predictions", PredictionsJson);

        var points = await Build(handler).GetTidePredictionsAsync(
            "9447130", new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc), new DateTime(2026, 9, 4, 0, 0, 0, DateTimeKind.Utc));

        Assert.All(points, p => Assert.Equal(DateTimeKind.Utc, p.Timestamp.Kind));
    }

    [Fact]
    public async Task Extrema_keep_their_high_low_tag()
    {
        const string hiloJson = """
        {
          "predictions": [
            { "t": "2026-09-03 03:10", "v": "0.71", "type": "L" },
            { "t": "2026-09-03 09:42", "v": "4.33", "type": "H" }
          ]
        }
        """;
        var handler = new StubHttpMessageHandler().RespondsTo("interval=hilo", hiloJson);

        var extrema = await Build(handler).GetTideExtremaAsync(
            "9447130", new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc), new DateTime(2026, 9, 4, 0, 0, 0, DateTimeKind.Utc));

        Assert.Equal(TideExtremumKind.Low, extrema[0].Kind);
        Assert.Equal(0.71, extrema[0].Value);
        Assert.Equal(TideExtremumKind.High, extrema[1].Kind);
        Assert.Equal(new DateTime(2026, 9, 3, 9, 42, 0, DateTimeKind.Utc), extrema[1].Timestamp);
    }

    [Fact]
    public async Task No_data_at_a_station_comes_back_empty_rather_than_throwing()
    {
        // NOAA answers "no data" with a 200 and an error body, so a service that only checked the
        // status code would hand the chart a null series and call it success.
        const string errorJson = """
        { "error": { "message": "No Predictions data was found. Please make sure the Datum input is valid." } }
        """;
        var handler = new StubHttpMessageHandler().RespondsTo("product=predictions", errorJson);

        var points = await Build(handler).GetTidePredictionsAsync(
            "9999999", new DateTime(2026, 9, 3, 0, 0, 0, DateTimeKind.Utc), new DateTime(2026, 9, 4, 0, 0, 0, DateTimeKind.Utc));

        Assert.Empty(points);
    }

    [Fact]
    public async Task Station_list_keeps_only_west_coast_reference_stations()
    {
        // Subordinate stations ("S") publish high/low offsets only and error on an interval
        // request, and the app doesn't cover states outside WA/OR/CA.
        const string stationsJson = """
        {
          "stations": [
            { "id": "9447130", "name": "Seattle", "lat": 47.6026, "lng": -122.3393, "state": "WA", "type": "R" },
            { "id": "9410170", "name": "San Diego", "lat": 32.7142, "lng": -117.1736, "state": "CA", "type": "R" },
            { "id": "9447131", "name": "Some Subordinate", "lat": 47.5, "lng": -122.4, "state": "WA", "type": "S" },
            { "id": "8518750", "name": "The Battery", "lat": 40.7, "lng": -74.0, "state": "NY", "type": "R" }
          ]
        }
        """;
        var handler = new StubHttpMessageHandler().RespondsTo("stations.json", stationsJson);

        var stations = await Build(handler).GetAllStationsAsync();

        Assert.Equal(new[] { "9447130", "9410170" }, stations.Select(s => s.Code));
        Assert.All(stations, s => Assert.Equal("MLLW", s.Datum));
        Assert.All(stations, s => Assert.Equal("America/Los_Angeles", s.TimeZone));
        Assert.All(stations, s => Assert.Equal(StationSource.Noaa, s.Source));
    }
}
