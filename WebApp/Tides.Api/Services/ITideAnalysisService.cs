using Tides.Api.Models;

namespace Tides.Api.Services;

public interface ITideAnalysisService
{
    LowestTideAnalysis Analyze(List<TideDataPoint> dataPoints, string timeZoneId);
    CurrentTideLevel? ComputeCurrentLevel(List<TideDataPoint> dataPoints, DateTime now, string timeZoneId, string source);
}
