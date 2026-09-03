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

        if (!DateTime.TryParse(from, out var fromDate) || !DateTime.TryParse(to, out var toDate))
            return BadRequest(new { error = "Invalid from/to date format. Use yyyy-MM-dd." });

        fromDate = DateTime.SpecifyKind(fromDate, DateTimeKind.Utc);
        toDate = DateTime.SpecifyKind(toDate, DateTimeKind.Utc);

        var rangeError = ValidateDateRange(fromDate, toDate);
        if (rangeError != null)
            return BadRequest(new { error = rangeError });

        var dataPoints = await _stations.GetTidePredictionsAsync(station, fromDate, toDate);
        var extrema = await GetExtremaWithFallbackAsync(station, dataPoints, fromDate, toDate);

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
            Station = station,
            From = fromDate,
            To = toDate,
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

        if (!DateTime.TryParse(from, out var fromDate) || !DateTime.TryParse(to, out var toDate))
            return BadRequest(new { error = "Invalid from/to date format. Use yyyy-MM-dd." });

        fromDate = DateTime.SpecifyKind(fromDate, DateTimeKind.Utc);
        toDate = DateTime.SpecifyKind(toDate, DateTimeKind.Utc);

        var rangeError = ValidateDateRange(fromDate, toDate);
        if (rangeError != null)
            return BadRequest(new { error = rangeError });

        var dataPoints = await _stations.GetTidePredictionsAsync(station, fromDate, toDate);
        var extrema = await GetExtremaWithFallbackAsync(station, dataPoints, fromDate, toDate);
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
