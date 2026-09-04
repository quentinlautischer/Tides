using Microsoft.AspNetCore.Mvc;
using Tides.Api.Controllers;
using Tides.Api.Models;
using Tides.Api.Services;
using Tides.Api.Tests.Fakes;

namespace Tides.Api.Tests;

/// <summary>
/// The last hop before the chart. The heights must come through untouched, and the timestamps
/// must arrive as the station's own wall clock - the client charts them as bare local time, so a
/// point that is right to the metre but wrong by an offset draws the tide at the wrong hour.
/// </summary>
public class TidePredictionsControllerTests
{
    private static readonly Station Kitsilano = new()
    {
        Id = "kits",
        Code = "07735",
        OfficialName = "Kitsilano",
        TimeZone = "America/Vancouver",
        Source = StationSource.Iwls,
        Country = "Canada",
        Datum = "Chart Datum",
    };

    private static TidePredictionsController Build(FakeStationDirectory directory) =>
        new(directory, new TideAnalysisService());

    private static TidePredictionResponse Body(IActionResult result) =>
        Assert.IsType<TidePredictionResponse>(Assert.IsType<OkObjectResult>(result).Value);

    [Fact]
    public async Task Charted_points_are_the_upstream_heights_at_the_stations_own_clock()
    {
        // 2026-09-03 is PDT, so America/Vancouver is UTC-7: 18:00Z is 11:00 that morning.
        var directory = new FakeStationDirectory(Kitsilano, [
            new TideDataPoint { Timestamp = new DateTime(2026, 9, 3, 18, 0, 0, DateTimeKind.Utc), Value = 3.94 },
            new TideDataPoint { Timestamp = new DateTime(2026, 9, 3, 18, 15, 0, DateTimeKind.Utc), Value = 3.91 },
        ]);

        var body = Body(await Build(directory).GetTidePredictions("07735", "2026-09-03", "2026-09-06"));

        Assert.Equal(new[] { 3.94, 3.91 }, body.DataPoints.Select(p => p.Value));
        Assert.Equal(new DateTime(2026, 9, 3, 11, 0, 0), body.DataPoints[0].Timestamp);
        Assert.Equal(new DateTime(2026, 9, 3, 11, 15, 0), body.DataPoints[1].Timestamp);
    }

    [Fact]
    public async Task The_requested_days_are_the_stations_days_not_utc_ones()
    {
        // Asking for Sep 3 means Sep 3 where the station is. Read as UTC midnight instead, the
        // whole window slides by the station's offset and the chart opens on the afternoon of
        // the day before.
        var directory = new FakeStationDirectory(Kitsilano);

        await Build(directory).GetTidePredictions("07735", "2026-09-03", "2026-09-06");

        Assert.Equal(new DateTime(2026, 9, 3, 7, 0, 0, DateTimeKind.Utc), directory.RequestedFromUtc);
        Assert.Equal(new DateTime(2026, 9, 6, 7, 0, 0, DateTimeKind.Utc), directory.RequestedToUtc);
    }

    [Fact]
    public async Task A_window_spanning_the_dst_change_uses_each_days_own_offset()
    {
        // Deliberately a past autumn: Vancouver went back to standard time on 2020-11-01, so the
        // window opens at UTC-7 and closes at UTC-8 and a single fixed offset would be an hour
        // out at one end. Historical offsets are settled, where future ones are not - the zone's
        // 2026 rules have already changed under this test once, and asserting on them would make
        // this fail on a tzdata update rather than on a regression.
        var directory = new FakeStationDirectory(Kitsilano);

        await Build(directory).GetTidePredictions("07735", "2020-10-30", "2020-11-04");

        Assert.Equal(new DateTime(2020, 10, 30, 7, 0, 0, DateTimeKind.Utc), directory.RequestedFromUtc);
        Assert.Equal(new DateTime(2020, 11, 4, 8, 0, 0, DateTimeKind.Utc), directory.RequestedToUtc);
    }

    [Fact]
    public async Task Published_turning_points_are_preferred_over_derived_ones()
    {
        // The authority's own highs and lows land on their real minute; ones recovered from the
        // 15-minute series are only ever accurate to the sample. Where both exist the published
        // set must win, or the table and the chart's markers disagree about where a low is.
        var directory = new FakeStationDirectory(Kitsilano,
            points: [
                new TideDataPoint { Timestamp = new DateTime(2026, 9, 3, 10, 0, 0, DateTimeKind.Utc), Value = 2.0 },
                new TideDataPoint { Timestamp = new DateTime(2026, 9, 3, 10, 15, 0, DateTimeKind.Utc), Value = 1.0 },
                new TideDataPoint { Timestamp = new DateTime(2026, 9, 3, 10, 30, 0, DateTimeKind.Utc), Value = 2.0 },
            ],
            extrema: [
                new TideExtremum { Timestamp = new DateTime(2026, 9, 3, 10, 22, 0, DateTimeKind.Utc), Value = 0.71, Kind = TideExtremumKind.Low },
            ]);

        var body = Body(await Build(directory).GetTidePredictions("07735", "2026-09-03", "2026-09-04"));

        var only = Assert.Single(body.Extrema);
        Assert.Equal(0.71, only.Value);
        Assert.Equal(new DateTime(2026, 9, 3, 3, 22, 0), only.Timestamp);
    }

    [Fact]
    public async Task An_unknown_station_is_a_404_rather_than_an_empty_chart()
    {
        var result = await Build(new FakeStationDirectory(Kitsilano)).GetTidePredictions("nope", "2026-09-03", "2026-09-06");

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Theory]
    [InlineData("2026-09-06", "2026-09-03")]  // backwards
    [InlineData("2026-09-03", "2028-09-03")]  // past the one-year cap
    [InlineData("not-a-date", "2026-09-06")]
    public async Task An_unusable_date_range_is_refused(string from, string to)
    {
        var result = await Build(new FakeStationDirectory(Kitsilano)).GetTidePredictions("07735", from, to);

        Assert.IsType<BadRequestObjectResult>(result);
    }
}
