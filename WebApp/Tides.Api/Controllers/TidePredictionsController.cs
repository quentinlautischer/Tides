using Microsoft.AspNetCore.Mvc;
using Tides.Api.Models;
using Tides.Api.Services;

namespace Tides.Api.Controllers;

[ApiController]
[Route("api/tides")]
public class TidePredictionsController : ControllerBase
{
    private readonly IIwlsApiService _iwlsService;
    private readonly ITideAnalysisService _analysisService;

    public TidePredictionsController(IIwlsApiService iwlsService, ITideAnalysisService analysisService)
    {
        _iwlsService = iwlsService;
        _analysisService = analysisService;
    }

    [HttpGet("{code}")]
    public async Task<IActionResult> GetTidePredictions(string code, [FromQuery] string from, [FromQuery] string to)
    {
        var station = await _iwlsService.GetStationByCodeAsync(code);
        if (station == null)
            return NotFound(new { error = $"Station with code '{code}' not found" });

        if (!DateTime.TryParse(from, out var fromDate) || !DateTime.TryParse(to, out var toDate))
            return BadRequest(new { error = "Invalid from/to date format. Use yyyy-MM-dd." });

        fromDate = DateTime.SpecifyKind(fromDate, DateTimeKind.Utc);
        toDate = DateTime.SpecifyKind(toDate, DateTimeKind.Utc);

        var dataPoints = await _iwlsService.GetTidePredictionsAsync(station.Id, fromDate, toDate);

        var tz = TimeZoneInfo.FindSystemTimeZoneById(station.TimeZone);
        var localDataPoints = dataPoints.Select(dp => new TideDataPoint
        {
            Timestamp = TimeZoneInfo.ConvertTimeFromUtc(dp.Timestamp, tz),
            Value = dp.Value
        }).ToList();

        return Ok(new TidePredictionResponse
        {
            Station = station,
            From = fromDate,
            To = toDate,
            DataPoints = localDataPoints
        });
    }

    [HttpGet("{code}/analysis")]
    public async Task<IActionResult> GetAnalysis(string code, [FromQuery] string from, [FromQuery] string to)
    {
        var station = await _iwlsService.GetStationByCodeAsync(code);
        if (station == null)
            return NotFound(new { error = $"Station with code '{code}' not found" });

        if (!DateTime.TryParse(from, out var fromDate) || !DateTime.TryParse(to, out var toDate))
            return BadRequest(new { error = "Invalid from/to date format. Use yyyy-MM-dd." });

        fromDate = DateTime.SpecifyKind(fromDate, DateTimeKind.Utc);
        toDate = DateTime.SpecifyKind(toDate, DateTimeKind.Utc);

        var dataPoints = await _iwlsService.GetTidePredictionsAsync(station.Id, fromDate, toDate);
        var analysis = _analysisService.Analyze(dataPoints, station.TimeZone);

        return Ok(analysis);
    }
}
