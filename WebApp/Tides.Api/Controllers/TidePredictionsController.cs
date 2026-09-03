using Microsoft.AspNetCore.Mvc;
using Tides.Api.Models;
using Tides.Api.Services;

namespace Tides.Api.Controllers;

[ApiController]
[Route("api/tides")]
public class TidePredictionsController : ControllerBase
{
    // Tide data is inherently a yearly cycle; a span beyond this has no legitimate use case
    // and would otherwise queue thousands of sequential upstream requests (see GetTidePredictionsAsync).
    private const int MaxDateRangeDays = 366;

    private readonly ITideStationDirectory _stations;
    private readonly ITideAnalysisService _analysisService;

    public TidePredictionsController(ITideStationDirectory stations, ITideAnalysisService analysisService)
    {
        _stations = stations;
        _analysisService = analysisService;
    }

    /// <summary>
    /// Resolves the requested `from`/`to` dates into the UTC instants to fetch.
    /// The dates name days at the *station*, not in UTC: everything downstream - the charted
    /// timestamps, the analysis day buckets - is in the station's local time, so parsing them as
    /// UTC midnight shifted the whole window by the station's offset. Asking for Sep 2-5 at a
    /// UTC-7 station used to return Sep 1 17:00 through Sep 4 17:00.
    /// </summary>
    private static bool TryResolveWindow(
        string from, string to, Station station,
        out DateTime fromUtc, out DateTime toUtc, out DateTime fromLocal, out DateTime toLocal,
        out string? error)
    {
        fromUtc = toUtc = fromLocal = toLocal = default;

        if (!DateTime.TryParse(from, out fromLocal) || !DateTime.TryParse(to, out toLocal))
        {
            error = "Invalid from/to date format. Use yyyy-MM-dd.";
            return false;
        }

        error = ValidateDateRange(fromLocal, toLocal);
        if (error != null)
            return false;

        var tz = TimeZoneInfo.FindSystemTimeZoneById(station.TimeZone);
        fromUtc = ToUtc(fromLocal, tz);
        toUtc = ToUtc(toLocal, tz);
        return true;
    }

    private static DateTime ToUtc(DateTime localDate, TimeZoneInfo tz)
    {
        var wallClock = DateTime.SpecifyKind(localDate, DateTimeKind.Unspecified);

        // Midnight is a time that doesn't exist in zones whose DST jump happens at 00:00, and
        // ConvertTimeToUtc throws on those rather than picking a side. Step to the first instant
        // that does exist. (An ambiguous midnight, on the way back, resolves to standard time
        // on its own and needs no help.)
        while (tz.IsInvalidTime(wallClock))
            wallClock = wallClock.AddMinutes(15);

        return TimeZoneInfo.ConvertTimeToUtc(wallClock, tz);
    }

    private static string? ValidateDateRange(DateTime fromDate, DateTime toDate)
    {
        if (toDate < fromDate)
            return "Invalid date range: 'to' must not be earlier than 'from'.";

        if ((toDate - fromDate).TotalDays > MaxDateRangeDays)
            return $"Invalid date range: span must not exceed {MaxDateRangeDays} days.";

        return null;
    }

    [HttpGet("{code}")]
    public async Task<IActionResult> GetTidePredictions(string code, [FromQuery] string from, [FromQuery] string to)
    {
        var station = await _stations.GetStationByCodeAsync(code);
        if (station == null)
            return NotFound(new { error = $"Station with code '{code}' not found" });

        if (!TryResolveWindow(from, to, station, out var fromUtc, out var toUtc, out var fromLocal, out var toLocal, out var error))
            return BadRequest(new { error });

        var dataPoints = await _stations.GetTidePredictionsAsync(station, fromUtc, toUtc);
        var extrema = await GetExtremaWithFallbackAsync(station, dataPoints, fromUtc, toUtc);

        var tz = TimeZoneInfo.FindSystemTimeZoneById(station.TimeZone);
        var localDataPoints = dataPoints.Select(dp => new TideDataPoint
        {
            Timestamp = TimeZoneInfo.ConvertTimeFromUtc(dp.Timestamp, tz),
            Value = dp.Value
        }).ToList();

        var localExtrema = extrema.Select(e => new TideExtremum
        {
            Timestamp = TimeZoneInfo.ConvertTimeFromUtc(e.Timestamp, tz),
            Value = e.Value,
            Kind = e.Kind
        }).ToList();

        return Ok(new TidePredictionResponse
        {
            // Echoed back as the local dates that were asked for, matching the convention the
            // timestamps below use. The client keys its cache off these.
            Station = station,
            From = fromLocal,
            To = toLocal,
            DataPoints = localDataPoints,
            Extrema = localExtrema
        });
    }

    [HttpGet("{code}/current")]
    public async Task<IActionResult> GetCurrentLevel(string code)
    {
        var station = await _stations.GetStationByCodeAsync(code);
        if (station == null)
            return NotFound(new { error = $"Station with code '{code}' not found" });

        var now = DateTime.UtcNow;

        var points = await _stations.GetObservedWaterLevelAsync(station, now.AddHours(-3), now.AddMinutes(15));
        var source = "Observed";

        if (points.Count < 2)
        {
            points = await _stations.GetTidePredictionsAsync(station, now.AddHours(-1), now.AddHours(1));
            source = "Predicted";
        }

        var current = _analysisService.ComputeCurrentLevel(points, now, station.TimeZone, source);
        if (current == null)
            return NotFound(new { error = "No current tide data available for this station" });

        return Ok(current);
    }

    [HttpGet("{code}/analysis")]
    public async Task<IActionResult> GetAnalysis(string code, [FromQuery] string from, [FromQuery] string to)
    {
        var station = await _stations.GetStationByCodeAsync(code);
        if (station == null)
            return NotFound(new { error = $"Station with code '{code}' not found" });

        if (!TryResolveWindow(from, to, station, out var fromUtc, out var toUtc, out _, out _, out var error))
            return BadRequest(new { error });

        var dataPoints = await _stations.GetTidePredictionsAsync(station, fromUtc, toUtc);
        var extrema = await GetExtremaWithFallbackAsync(station, dataPoints, fromUtc, toUtc);
        var analysis = _analysisService.Analyze(extrema, station.TimeZone);

        return Ok(analysis);
    }

    /// <summary>
    /// The authority's own turning points where it publishes them, otherwise the ones implied by
    /// the 15-minute series. Both endpoints go through here so the table and the chart's markers
    /// can never disagree about where a low is.
    /// </summary>
    private async Task<List<TideExtremum>> GetExtremaWithFallbackAsync(
        Station station, List<TideDataPoint> dataPoints, DateTime fromDate, DateTime toDate)
    {
        var extrema = await _stations.GetTideExtremaAsync(station, fromDate, toDate);
        return extrema.Count > 0 ? extrema : _analysisService.DeriveExtrema(dataPoints);
    }
}
